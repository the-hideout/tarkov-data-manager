const { WebhookClient, MessageEmbed } = require('discord.js');

let webhookClient = false;

if (process.env.WEBHOOK_URL) {
    const options = {
        url: process.env.WEBHOOK_URL
    };
    webhookClient = new WebhookClient(options);
    if (process.env.WEBHOOK_USER) {
        webhookClient.name = process.env.WEBHOOK_USER;
    }
}

const sendWebhook = async (message) => {
    if (!webhookClient) {
        console.log("No webhook URL set, printing alert to console instead:");
        console.log(message);
        return;
    }
    if (typeof message === 'string') {
        message = {
            title: message
        };
    }
    const embed = new MessageEmbed();
    if (message.title) {
        if (message.title.length > 256) {
            if (!message.message) {
                message.message = message.title;
            }
            message.title = message.title.substring(0, 256);
        }
        embed.setTitle(message.title);
    }
    if (message.message) {
        if (typeof message.message !== 'string') {
            if (typeof message.message !== 'object') {
                message.message = message.message.toString();
            } else {
                message.message = '`'+JSON.stringify(message.message, null, 4)+'`';
            }
        }
        embed.setDescription(message.message);
    }
    return webhookClient.send({
        embeds: [embed]
    });
};

// add the code below
module.exports = {
    alert: sendWebhook
};
