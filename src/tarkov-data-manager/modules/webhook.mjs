import  { WebhookClient, EmbedBuilder } from 'discord.js';

let webhookClient;

if (process.env.WEBHOOK_URL) {
    const options = {
        url: process.env.WEBHOOK_URL
    };
    webhookClient = new WebhookClient(options);
    if (process.env.WEBHOOK_USER) {
        webhookClient.name = process.env.WEBHOOK_USER;
    }
}

// add the code below
const webhook = {
    alert: async (message, logger) => {
        if (!logger) {
            logger = console;
        }
        if (!webhookClient) {
            logger.log("No webhook URL for alert:");
            logger.log(message);
            return;
        }
        if (typeof message === 'string') {
            message = {
                title: message
            };
        }
        const embed = new EmbedBuilder();
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
                    if (message.stack) {
                        message.message = message.stack;
                    } else {
                        message.message = '`'+JSON.stringify(message.message, null, 4)+'`';
                    }
                }
            }
            embed.setDescription(message.message);
        }
        return webhookClient.send({
            embeds: [embed]
        });
    },
    send: (message, logger) => {
        if (!logger) {
            logger = console;
        }
        if (!webhookClient) {
            logger.log('No webhook URL for message:');
            logger.log(message);
            return;
        }
        return webhookClient.send(message);
    },
};

export const { alert, send } = webhook;

export default webhook;
