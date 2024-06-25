import got from 'got';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';

class VerifyWikiJob extends DataJob {
    constructor(options) {
        super({...options, name: 'verify-wiki'});
    }

    async run() {
        [this.items, this.presets] = await Promise.all([
            remoteData.get(),
            this.jobManager.jobOutput('update-presets', this),
        ]);
        let missingWikiLinkCount = 0;
        const promises = [];
        this.logger.log('Verifying wiki links');
        for (const item of this.items.values()) {
            if (promises.length >= 10) {
                await Promise.all(promises);
                promises.length = 0;
            }
            if (item.types.includes('disabled') || item.types.includes('quest')) {
                continue;
            }
            promises.push(new Promise(async (resolve) => {
                let shouldRemoveCurrentLink = false;
                let newWikiLink = false;

                if (item.wiki_link){
                    try {
                        const currentPage = await got(item.wiki_link);
                        const matches = currentPage.body.match(/rel="canonical" href="(?<canonical>.+)"/);

                        // We have the right link. Move on
                        if(matches.groups.canonical === item.wiki_link){
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
                if (!newWikiLink && !item.types.includes('preset')){
                    try {
                        const templatePage = await got(`https://escapefromtarkov.fandom.com/wiki/Template:${item.id}`);
                        const matches = templatePage.body.match(/<div class="mw-parser-output"><p><a href="(?<link>[^"]+)"/);

                        if (matches) {
                            newWikiLink = `https://escapefromtarkov.fandom.com${matches.groups.link}`;
                        }
                    } catch (requestError){
                        // nothing to do
                    }
                }

                // We still don't have a wiki link, let's try to guess one
                if (!newWikiLink){
                    if (!item.types.includes('preset')) {
                        newWikiLink = nameToWikiLink(item.name);
                    } else {
                        const baseItem = this.items.get(this.presets[item.id].baseId);
                        newWikiLink = nameToWikiLink(baseItem.name);
                    }

                    try {
                        await got.head(newWikiLink);
                    } catch (requestError){
                        missingWikiLinkCount = missingWikiLinkCount + 1;
                        newWikiLink = false;
                        this.logger.warn(`${item.name} (${item.id}) missing wiki link`);
                    }
                }

                if (shouldRemoveCurrentLink && newWikiLink) {
                    shouldRemoveCurrentLink = false;
                }

                if (shouldRemoveCurrentLink && item.wiki_link){
                    await this.postMessage(item, newWikiLink);
                    remoteData.setProperty(item.id, 'wiki_link', '');
                }

                if (newWikiLink){
                    await this.postMessage(item, newWikiLink);
                    remoteData.setProperty(item.id, 'wiki_link', newWikiLink);
                }
                return resolve();
            }));
        }
        await Promise.all(promises);
        // Possibility to POST to a Discord webhook here with cron status details
        this.logger.log(`${missingWikiLinkCount} items still missing a valid wiki link`);
    }

    postMessage = (item, foundNewLink) => {
        const messageData = {
            title: 'Broken wiki link',
            message: item.name
        };
    
        if (foundNewLink) {
            this.logger.succeed(`${item.name} (${item.id}): wiki link updated`);
    
            messageData.title = 'Updated wiki link';
            messageData.message = item.name;
        } else {
            this.logger.fail(`${item.name} (${item.id}): wiki link removed`);
        }
    
        return this.discordAlert(messageData);
    }
}

const nameToWikiLink = (name) => {
    const formattedName = name
        .replace(/\s/g, '_')
        .replace(/&/, '%26')
        .replace(/'/, '%27');

    return `https://escapefromtarkov.fandom.com/wiki/${formattedName}`;
};

export default VerifyWikiJob;
