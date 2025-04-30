import discord from 'discord.js';

import db from './db-connection.mjs';

const { WebhookClient, MessageEmbed } = discord;

const clients = {};
const WEBHOOK_BASE = 'https://discord.com/api/webhooks/';

(async () => {
    if (process.env.WEBHOOK_DESTINATIONS) {
        const dests = process.env.WEBHOOK_DESTINATIONS.split(',')
        for (let i = 0; i < dests.length; i++) {
            const hookStub = dests[i].replace(WEBHOOK_BASE, '');
            clients[hookStub] = new WebhookClient({
                url: WEBHOOK_BASE+hookStub
            })
        }
    }
})();

const processRollbarWebhook = async (res, payload, client) => {
    if (payload.event_name !== 'new_item' && payload.event_name !== 'test') {
        return res.status(422).send();
    }
    if ((!payload.data || !payload.data.item) && payload.event_name !== 'test') {
        return res.status(422).send();
    }
    const item = payload.data.item;
    const embed = new MessageEmbed();
    embed.setAuthor({name: 'Rollbar'});
    embed.setTitle(item.title);
    if (payload.event_name === 'test') {
        embed.setDescription(payload.data.message);
    } else {
        embed.setDescription('`'+JSON.stringify(item.last_occurrence.body, null, 4)+'`');
    }
    try {
        await client.send({
            username: 'Rollbar',
            avatarURL: 'https://avatars.githubusercontent.com/u/3219584',
            embeds: [embed]
        });
    } catch (error) {
        return res.status(500).send();
    }
    return res.status(200).send();
};

const processTestWebhook = async (res, payload, client) => {
    const embed = new MessageEmbed();
    embed.setAuthor({name: 'Test'});
    embed.setTitle('Test Webhook');
    embed.setDescription('`'+JSON.stringify(payload, null, 4)+'`');
    try {
        await client.send({
            username: 'Webhook Test',
            embeds: [embed]
        });
    } catch (error) {
        return res.status(500).send();
    }
    return res.status(200).send();
};

const refreshWebhooks = async () => {
    const results = await db.query('SELECT * from webhooks');
    users = {};
    for (let i = 0; i < results.length; i++) {
        users[results[i].username] = results[i].password;
    }
};

const webhookApi = {
    handle: async (req, res, hooksource, destination) => {
        const validSources = [
            'rollbar',
            'test'
        ];
        if (!validSources.includes(hooksource) || !clients[destination]) {
            return response.status(401).send();
        }
        try {
            if (hooksource === 'rollbar') {
                return processRollbarWebhook(res, req.body, clients[destination]);
            }
            if (hooksource === 'test') {
                return processTestWebhook(res, req.body, clients[destination]);
            }
            res.status(400).send();
        } catch (error) {
            console.log('Webhook API Error', error);
            response.status(500).send();
        }
    },
    refresh: refreshWebhooks
};

export default webhookApi;
