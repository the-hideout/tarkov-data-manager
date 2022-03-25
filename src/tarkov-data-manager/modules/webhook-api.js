const { WebhookClient, MessageEmbed } = require('discord.js');

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
    if (payload.event_name !== 'new_item') {
        return res.status(422).send();
    }
    if (!payload.data || !payload.data.item) {
        return res.status(422).send();
    }
    const item = payload.data.item;
    const embed = new MessageEmbed();
    embed.setAuthor({name: 'Rollbar'});
    embed.setTitle(item.title);
    embed.setDescription('`'+JSON.stringify(item.last_occurrence.body, null, 4)+'`');
    try {
        await client.send({
            username: 'Rollbar',
            embeds: [embed]
        });
    } catch (error) {
        response.status(500).send();
    }
    return res.status(200).send();
};

module.exports = async (req, res, hooksource, destination) => {
    const validSources = [
        'rollbar'
    ];
    if (!validSources.includes(hooksource) || !clients[destination]) {
        return response.status(401).send();
    }
    try {
        if (hooksource === 'rollbar') {
            return processRollbarWebhook(res, req.body, clients[destination]);
        }
        res.status(400).send();
    } catch (error) {
        console.log('Webhook API Error', error);
        response.status(500).send();
    }
};