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
                        const templatePage = await got(this.getWikiLink(`Template:${item.id}`));
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
                        newWikiLink = this.getWikiLink(item.name);
                    } else {
                        const baseItem = this.items.get(this.presets[item.id].baseId);
                        newWikiLink = this.getWikiLink(baseItem.name);
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
                    this.addJobSummary(item.name, 'Broken Wiki Link');
                    remoteData.setProperty(item.id, 'wiki_link', '');
                }

                if (newWikiLink){
                    this.addJobSummary(item.name, 'Updated Wiki Link');
                    remoteData.setProperty(item.id, 'wiki_link', newWikiLink);
                }
                return resolve();
            }));
        }
        await Promise.all(promises);
        // Possibility to POST to a Discord webhook here with cron status details
        this.logger.log(`${missingWikiLinkCount} items still missing a valid wiki link`);
    }
}

export default VerifyWikiJob;
