const { EventEmitter } = require('events');

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const sleep = require('./sleep');
const scannerFramework = require('./scanner-framework');

const emitter = new EventEmitter();

const validRoles = [
    'scanner',
    'listener',
    'overseer',
];

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

wss.on('connection', (client, req) => {
    const url = new URL(`http://localhost${req.url}`);
    let terminateReason = false;
    if (url.searchParams.get('password') !== process.env.WS_PASSWORD && !scannerFramework.validateUser(url.searchParams.get('username'), url.searchParams.get('password'))) {
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

    if (client.role === 'scanner') {
        client.username = url.searchParams.get('username');
        client.status = url.searchParams.get('status') || 'unknown';
        client.settings = {
            fleaMarketAvailable: url.searchParams.get('fleamarket') === 'true',
            scanMode: url.searchParams.get('scanmode') ? url.searchParams.get('scanmode') : 'auto',
        };
        client.name = client.sessionId;
        sendMessage(client.sessionId, 'connected', {status: client.status, settings: client.settings});
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

    client.on('message', (rawMessage) => {
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

        if (message.type === 'status') {
            client.status = message.data.status;
            client.settings = message.data.settings;
            emitter.emit('scannerStatusUpdated', client);
            sendMessage(client.sessionId, 'status', message.data);
        }

        if (message.type === 'request') {
            // scanner has requested something
            const response = {
                requestId: message.requestId,
            };
            try {

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

scannerFramework.on('userDisabled', (username) => {
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
    async sendCommand(sessionId, name, data) {
        return new Promise((resolve) => {
            let commandId, commandResponseTimeout;

            const client = [...wss.clients].find(c => c.readyState === WebSocket.OPEN && c.sessionId === sessionId && c.role === 'scanner');
            if (!client) {
                return resolve({error: `Could not find scanner with name ${sessionId}`});
            }
            commandId = uuidv4();
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
                resolve({error: 'Timed out waiting for response'});
            }, 1000 * 30);
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
        return connected.filter(client => availableStatuses.includes(client.status));
    },
    async getJson(jsonName) {
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
        let clients = connectedJson.includes(jsonName) ? webSocketServer.connectedScanners() : webSocketServer.launchedScanners();
        if (fleaMarketJson.includes(jsonName)) {
            const fleaClients = clients.filter(c => c.settings.fleaMarketAvailable);
            if (fleaClients.length > 0) {
                clients = fleaClients;
            }
        }
        if (clients.length === 0) {
            return Promise.reject(new Error(`No scanners available to refresh ${jsonName} JSON`));
        }
        const client = clients[Math.floor(Math.random()*clients.length)];
        const response = await webSocketServer.sendCommand(client.sessionId, 'getJson', {name: jsonName});
        if (response.error) {
            return Promise.reject(new Error(response.error));
        }
        return response.data;
    },
    on: (event, listener) => {
        return emitter.on(event, listener);
    },
    off: (event, listener) => {
        return emitter.off(event, listener);
    },
    once: (event, listener) => {
        return emitter.once(event, listener);
    },
};

module.exports = webSocketServer;
