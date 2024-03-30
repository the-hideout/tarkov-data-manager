const { EventEmitter } = require('events');

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const sleep = require('./sleep');

const emitter = new EventEmitter();

const wss = new WebSocket.Server({
    port: process.env.WS_PORT || 5000,
}, () => {
    wss.listening = true;
});
wss.listening = false;

const pingMessage = JSON.stringify({
    type: 'ping',
});

const sendMessage = (sessionId, type, data) => {
    const sentMessages = []
    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN || client.sessionId !== sessionId || client.role !== 'listener' ) {
            return;
        }
        sentMessages.push(client.send(JSON.stringify({
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
            return client.terminate();
        }

        client.isAlive = false;
        client.send(pingMessage);
    });
}, 10000);

wss.on('connection', (client) => {
    client.isAlive = true;
    client.status = 'unknown';
    const authTimeout = setTimeout(() => {
        if (client.authenticated) {
            return;
        }
        console.log(`Terminating ws client for lack of authentication`);
        client.terminate();
        client.terminated = new Date();
    }, 60000);
    client.log = [];

    client.on('message', (rawMessage) => {
        const message = JSON.parse(rawMessage);

        if (message.type === 'pong') {
            client.isAlive = true;

            return;
        }

        if (message.type === 'connect') {
            if (!message.sessionId) {
                console.log('No connect session Id provided; dropping message', message);
                return;
            }
            if (message.password !== process.env.WS_PASSWORD) {
                console.log('No connect password provided; dropping message', message);
                return;
            }
            if (!message.role) {
                console.log('No client role provided; dropping message', message);
                return;
            }
            clearTimeout(authTimeout);
            client.sessionId = message.sessionId;
            client.role = message.role;

            if (client.role === 'scanner') {
                client.status = message.status;
                client.fleaMarketAvailable = message.fleaMarketAvailable;
                client.name = client.sessionId;
            }
            if (client.role === 'listener') {
                // a listener just connected
                // tell scanner to transmit its log history
                webSocketServer.sendCommand(client.sessionId, 'fullStatus').then(commandResponse => {
                    client.send(JSON.stringify({
                        type: 'fullStatus',
                        data: commandResponse.data,
                    }));
                });
            }

            return;
        }

        //const sessionId = client.sessionId;
        if (!client.sessionId) {
            console.log('Not authenticated, dropping message', message);
            return;
        }

        if (message.type === 'command') {
            return webSocketServer.sendCommand(sessionId, message.name, message.data);
        }

        if (message.type === 'commandResponse') {
            emitter.emit('commandResponse', message);
            return;
        }

        if (message.type === 'debug') {
            sendMessage(client.sessionId, 'debug', message.data);

            return;
        }

        if (message.type === 'status') {
            client.status = message.data;
            sendMessage(client.sessionId, 'status', message.data);
        }
    });
});

wss.on('error', error => {
    console.error('WebSocket Server error', error);
});

wss.on('close', () => {
    clearInterval(pingInterval);
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
            }, 60000 * 30);
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
            const fleaClients = clients.filter(c => c.fleaMarketAvailable);
            if (fleaClients.length > 0) {
                clients = fleaClients;
            }
        }
        if (clients.length === 0) {
            return Promise.reject(new Error(`No scanners available to refresh ${jsonName} JSON`));
        }
        const client = clients[Math.floor(Math.random()*clients.length)];
        return webSocketServer.sendCommand(client.sessionId, 'getJson', {name: jsonName})
    }
};

module.exports = webSocketServer;
