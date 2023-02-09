const got = require('got');
const webhook = require('../modules/webhook');

const remoteData = require('../modules/remote-data');
const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

class VerifyWikiJob extends DataJob {
    constructor() {
        super('verify-wiki');
    }

    async run() {
        this.presets = {};
        try {
            this.presets = await this.jobManager.jobOutput('update-presets', this, true);
        } catch (error) {
            this.logger.error(error);
        }
        const en = await tarkovData.locale('en');
        let missing = 0;
        const promises = [];
        this.logger.log('Verifying wiki links');
        const results = await remoteData.get();
        for (const result of results.values()) {
            if (promises.length >= 10) {
                await Promise.all(promises);
                promises.length = 0;
            }
            if (result.types.includes('disabled') || result.types.includes('quest')) {
                continue;
            }
            promises.push(new Promise(async (resolve) => {
                let shouldRemoveCurrentLink = false;
                let newWikiLink = false;

                if(result.wiki_link){
                    try {
                        const currentPage = await got(result.wiki_link);
                        const matches = currentPage.body.match(/rel="canonical" href="(?<canonical>.+)"/);

                        // We have the right link. Move on
                        if(matches.groups.canonical === result.wiki_link){
                            return resolve();
                        }

                        // We don't have the right link, but there's a redirect
                        newWikiLink = matches.groups.canonical;
                    } catch (requestError){
                        // console.log(requestError);
                        shouldRemoveCurrentLink = true;
                    }
                }

                // We don't have a wiki link, let's try retrieving from the id
                if(!newWikiLink && !this.presets[result.id]){
                    try {
                        const templatePage = await got(`https://escapefromtarkov.fandom.com/wiki/Template:${result.id}`);
                        const matches = templatePage.body.match(/<div class="mw-parser-output"><p><a href="(?<link>[^"]+)"/);

                        if (matches) {
                            newWikiLink = `https://escapefromtarkov.fandom.com${matches.groups.link}`;
                        }
                    } catch (requestError){
                        // nothing to do
                    }
                }

                // We still don't have a wiki link, let's try to guess one
                if(!newWikiLink){
                    if (!this.presets[result.id]) {
                        newWikiLink = nameToWikiLink(result.name);
                    } else {
                        newWikiLink = nameToWikiLink(en[`${this.presets[result.id].baseId} Name`]);
                    }

                    try {
                        await got.head(newWikiLink);
                    } catch (requestError){
                        // console.log(requestError);
                        // this.postMessage(result.id, result.name, newWikiLink, 'broken');

                        missing = missing + 1;
                        newWikiLink = false;
                        this.logger.warn(`${result.name} (${result.id}) missing wiki link`);
                    }
                }

                if (shouldRemoveCurrentLink && newWikiLink) {
                    shouldRemoveCurrentLink = false;
                }

                if(shouldRemoveCurrentLink && result.wiki_link){
                    this.postMessage(result, newWikiLink);
                    remoteData.setProperty(result.id, 'wiki_link', '');
                }

                if(newWikiLink){
                    this.postMessage(result, newWikiLink);
                    remoteData.setProperty(result.id, 'wiki_link', newWikiLink);
                }
                return resolve();
            }));
        }
        await Promise.all(promises);
        // Possibility to POST to a Discord webhook here with cron status details
        this.logger.log(`${missing} items still missing a valid wiki link`);
    }

    postMessage = (item, foundNewLink) => {
        const messageData = {
            title: 'Broken wiki link',
            message: item.name
        };
    
        if (foundNewLink) {
            this.logger.succeed(`${item.id} | ${foundNewLink} | ${item.name}`);
    
            messageData.title = 'Updated wiki link';
            messageData.message = item.name;
        } else {
            this.logger.fail(`${item.id} | ${foundNewLink} | ${item.name}`);
        }
    
        return webhook.alert(messageData);
    }
}

const nameToWikiLink = (name) => {
    const formattedName = name
        .replace(/\s/g, '_')
        .replace(/&/, '%26')
        .replace(/'/, '%27');

    return `https://escapefromtarkov.fandom.com/wiki/${formattedName}`;
};

module.exports = VerifyWikiJob;
