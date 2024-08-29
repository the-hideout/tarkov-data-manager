import crypto from 'node:crypto';

import WebSocket from 'ws';
import sharp from 'sharp';

import sleep from './sleep.js';
import scannerApi from './scanner-api.mjs';
import emitter from './emitter.mjs';

const validRoles = [
    'scanner',
    'listener',
    'overseer',
];

let lastJsonScanner;

const wss = new WebSocket.Server({
    port: process.env.WS_PORT || 5000,
}, () => {
    wss.listening = true;
});
wss.listening = false;

const sendMessage = (sessionId, type, data) => {
    const sentMessages = []
    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN || (client.sessionId !== sessionId && client.role !== 'overseer') || (client.role !== 'listener' && client.role !== 'overseer')) {
            return;
        }
        sentMessages.push(client.send(JSON.stringify({
            sessionId: client.role === 'overseer' ? sessionId : undefined,
            type: type,
            data: data,
        })));
    });
    return sentMessages;
};

const pingInterval = setInterval(() => {
    //console.log(`active clients: ${wss.clients.size}`);

    wss.clients.forEach((client) => {
        if (client.isAlive === false) {
            console.log(`terminating ${client.sessionId}`);
            sendMessage(client.sessionId, 'disconnect');
            return client.terminate();
        }

        client.isAlive = false;
        client.send(JSON.stringify({
            type: 'ping',
        }));
    });
}, 10000);

const printClients = () => {
    console.log('Websocket clients:');
    wss.clients.forEach((client) => {
        console.log(`${client.sessionId}: ${client.role}`);
    });
    if (wss.clients.size === 0) {
        console.log('none');
    }
};

wss.on('connection', async (client, req) => {
    const url = new URL(`http://localhost${req.url}`);
    let terminateReason = false;
    if (url.searchParams.get('password') !== process.env.WS_PASSWORD && !await scannerApi.validateUser(url.searchParams.get('username'), url.searchParams.get('password'))) {
        terminateReason = 'authentication';
    }
    if (!url.searchParams.get('sessionid') && url.searchParams.get('role') !== 'overseer') {
        terminateReason = 'session ID';
    }
    if (!url.searchParams.get('role') || !validRoles.includes(url.searchParams.get('role'))) {
        terminateReason = 'role';
    }
    if (terminateReason) {
        console.log(`Terminating ws client missing valid ${terminateReason}`);
        client.terminate();
        return;
    }
    
    client.sessionId = url.searchParams.get('sessionid');
    client.role = url.searchParams.get('role');
    client.isAlive = true;
    client.log = [];
    client.settings = {};

    if (client.role === 'scanner') {
        client.username = url.searchParams.get('username');
        client.settings = JSON.parse(url.searchParams.get('settings'));
        client.settings.scanStatus = client.settings.scanStatus || 'unknown';
        client.name = client.sessionId;
        sendMessage(client.sessionId, 'connected', client.settings);
    }
    if (client.role === 'listener') {
        client.username = url.searchParams.get('username');
        // a listener just connected
        // tell scanner to transmit its log history
        webSocketServer.sendCommand(client.sessionId, 'fullStatus').then(commandResponse => {
            client.send(JSON.stringify({
                type: 'fullStatus',
                data: commandResponse.data,
            }));
        });
    }
    if (client.role === 'overseer') {
        wss.clients.forEach((scanner) => {
            if (scanner.readyState !== WebSocket.OPEN || scanner.role !== 'scanner') {
                return;
            }
            webSocketServer.sendCommand(scanner.sessionId, 'fullStatus').then(commandResponse => {
                client.send(JSON.stringify({
                    sessionId: scanner.sessionId,
                    type: 'fullStatus',
                    data: commandResponse.data,
                }));
            });
        });
    }
    printClients();

    client.on('message', async (rawMessage) => {
        const message = JSON.parse(rawMessage);

        if (message.type === 'pong') {
            client.isAlive = true;

            return;
        }

        if (!client.sessionId && !client.role === 'overseer') {
            console.log('Not authenticated, dropping message', message);
            return;
        }

        if (message.type === 'command') {
            // commands issued by overseer / listeners are forwarded to scanners
            return webSocketServer.sendCommand(client.sessionId || message.sessionId, message.name, message.data);
        }

        if (message.type === 'commandResponse') {
            // fire the commandResponse event
            // enables promise in sendCommand function to fulfill
            emitter.emit('commandResponse', message);
            return;
        }

        if (message.type === 'debug') {
            sendMessage(client.sessionId, 'debug', message.data);

            return;
        }

        if (message.type === 'settingsChanged') {
            for (const settingName in message.data) {
                client.settings[settingName] = message.data[settingName];
            }
            //console.log(client.sessionId, client.settings);
            sendMessage(client.sessionId, 'settingsChanged', client.settings);
        }

        if (message.type === 'request') {
            // scanner has requested something
            let response = {};
            try {
                if (message.name === 'createPresetFromOffer') {
                    let image;
                    if (message.data.image) {
                        image = sharp(Buffer.from(message.data.image, 'base64'));
                    }
                    response = await scannerApi.createPresetFromOffer(message.data.offer, image);
                }
            } catch (error) {
                response.error = error.message;
            }
            client.send(JSON.stringify({
                type: 'requestResponse',
                requestId: message.requestId,
                data: response,
            }));
        }
    });

    client.on('close', () => {
        sendMessage(client.sessionId, 'disconnect');
        printClients();
    });
});

wss.on('error', error => {
    console.error('WebSocket Server error', error);
});

wss.on('close', () => {
    clearInterval(pingInterval);
});

scannerApi.on('userDisabled', (username) => {
    wss.clients.forEach((client) => {
        if (client.role === 'overseer') {
            return;
        }
        if (client.username !== username) {
            return;
        }
        if (client.readyState !== WebSocket.OPEN) {
            return;
        }
        client.terminate();
    });
});

const webSocketServer = {
    close() {
        return new Promise(resolve => {    
            wss.on('close', resolve);
            wss.close();
            wss.clients.forEach((client) => {
                client.terminate();
            });
        });
    },
    async sendCommand(sessionId, name, data, timeout = 30000) {
        return new Promise((resolve) => {
            const client = [...wss.clients].find(c => c.readyState === WebSocket.OPEN && c.sessionId === sessionId && c.role === 'scanner');
            if (!client) {
                return resolve({error: `Could not find scanner with name ${sessionId}`});
            }
            let commandResponseTimeout;
            const commandId = crypto.randomUUID();
            const commandResponseHandler = (message) => {
                if (message.commandId !== commandId) {
                    return;
                }
                clearTimeout(commandResponseTimeout);
                emitter.off('commandResponse', commandResponseHandler);
                resolve(message.data);
            };
            commandResponseTimeout = setTimeout(() => {
                emitter.off('commandResponse', commandResponseHandler);
                resolve({error: `Timed out waiting for response from ${client.sessionId}`});
            }, timeout);
            emitter.on('commandResponse', commandResponseHandler);
            client.send(JSON.stringify({
                type: 'command',
                name,
                data,
                commandId,
            }));
        });
    },
    connectedScanners() {
        return [...wss.clients].filter(client => client.readyState === WebSocket.OPEN && client.role === 'scanner');
    },
    launchedScanners() {
        const connected = webSocketServer.connectedScanners();
        const availableStatuses = [
            'scanning',
            'idle',
            'paused'
        ];
        return connected.filter(client => availableStatuses.includes(client.settings.scanStatus));
    },
    async getJson(jsonName, sessionMode = 'regular') {
        while (!wss.listening) {
            await sleep(100);
        }
        if (process.env.TEST_JOB === 'true') {
            while (webSocketServer.connectedScanners().length < 1) {
                await sleep(1000);
            }
        }
        const connectedJson = ['status'];
        const fleaMarketJson = ['credits'];
        const anySessionMode = ['status', 'achievements'];
        let clients = connectedJson.includes(jsonName) ? webSocketServer.connectedScanners() : webSocketServer.launchedScanners();
        if (!anySessionMode.includes(jsonName)) {
            clients = clients.filter(c => c.settings.sessionMode === sessionMode);
        }
        if (fleaMarketJson.includes(jsonName)) {
            const fleaClients = clients.filter(c => c.settings.fleaMarketAvailable);
            if (fleaClients.length > 0) {
                clients = fleaClients;
            }
        }
        if (clients.length === 0) {
            return Promise.reject(new Error('No scanners available'));
        }
        if (clients.length > 1) {
            clients = clients.filter(c => c.sessionId !== lastJsonScanner);
        }
        const client = clients[Math.floor(Math.random()*clients.length)];
        lastJsonScanner = client.sessionId;
        const response = await webSocketServer.sendCommand(client.sessionId, 'getJson', {name: jsonName});
        if (response.error) {
            let errorMessage = response.error;
            if (errorMessage.includes('is not valid JSON')) {
                errorMessage = 'Invalid JSON';
            }
            if (!errorMessage.includes(`from ${client.sessionId}`)) {
                errorMessage += ` from ${client.sessionId}`;
            }
            return Promise.reject(new Error(errorMessage));
        }
        return response.data;
    },
    getImages: async (id) => {
        while (!wss.listening) {
            await sleep(100);
        }
        if (process.env.TEST_JOB === 'true') {
            /*while (webSocketServer.connectedScanners().length < 1) {
                await sleep(1000);
            }*/
        }
        const clients = webSocketServer.launchedScanners();
        if (clients.length === 0) {
            return Promise.reject(new Error('No scanners available'));
        }
        const client = clients[Math.floor(Math.random()*clients.length)];
        const response = await webSocketServer.sendCommand(client.sessionId, 'getImages', {id}, 60000);
        if (response.error) {
            let errorMessage = response.error;
            if (!errorMessage.includes(`from ${client.sessionId}`)) {
                errorMessage += ` from ${client.sessionId}`;
            }
            return Promise.reject(new Error(errorMessage));
        }
        const images = {};
        for (const imageId in response.data) {
            images[imageId] = sharp(Buffer.from(response.data[imageId], 'base64'));
        }
        return images;
    },
    getJsonImage: async (json) => {
        while (!wss.listening) {
            await sleep(100);
        }
        if (process.env.TEST_JOB === 'true') {
            /*while (webSocketServer.connectedScanners().length < 1) {
                await sleep(1000);
            }*/
        }
        const clients = webSocketServer.launchedScanners();
        if (clients.length === 0) {
            return Promise.reject(new Error('No scanners available'));
        }
        const client = clients[Math.floor(Math.random()*clients.length)];
        const response = await webSocketServer.sendCommand(client.sessionId, 'getJsonImage', {json}, 60000);
        if (response.error) {
            let errorMessage = response.error;
            if (!errorMessage.includes(`from ${client.sessionId}`)) {
                errorMessage += ` from ${client.sessionId}`;
            }
            return Promise.reject(new Error(errorMessage));
        }
        return sharp(Buffer.from(response.data, 'base64'));
    },
};

export default webSocketServer;
