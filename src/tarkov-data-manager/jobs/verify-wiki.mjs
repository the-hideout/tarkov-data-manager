import * as cheerio from 'cheerio';

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import sleep from '../modules/sleep.js';

class VerifyWikiJob extends DataJob {
    constructor(options) {
        super({...options, name: 'verify-wiki'});
    }

    async run() {
        [this.items] = await Promise.all([
            remoteData.get(),
        ]);
        let missingWikiLinkCount = 0;
        const jobs = new Map();
        this.logger.log('Verifying wiki links');
        for (const item of this.items.values()) {
            while (jobs.size >= 10) {
                await sleep(100);
            }
            if (item.types.includes('disabled') || item.types.includes('quest')) {
                continue;
            }
            const checkWikiPromise = new Promise(async (resolve) => {
                try {
                    let shouldRemoveCurrentLink = false;
                    let newWikiLink = false;

                    if (item.wiki_link) {
                        try {
                            const response = await fetch(item.wiki_link);
                            if (!response.ok) {
                                if (response.status === 404) {
                                    shouldRemoveCurrentLink = true;
                                } else {
                                    // request wasn't successful but wasn't a 404
                                    // don't change anything
                                    return resolve();
                                }
                                throw new Error('bad link');
                            }
                            const pageBody = await response.text();
                            const matches = pageBody.match(/rel="canonical" href="(?<canonical>.+)"/);

                            // We have the right link. Move on
                            if (matches.groups.canonical === item.wiki_link) {
                                return resolve();
                            }

                            // We don't have the right link, but there's a redirect
                            newWikiLink = matches.groups.canonical;
                        } catch (error) {

                        }
                    }

                    // We don't have a wiki link, let's try retrieving from the id
                    if (!newWikiLink) {
                        try {
                            let itemId = item.id;
                            if (item.types.includes('preset')) {
                                itemId = item.properties.items[0]._tpl;
                            }
                            const response = await fetch(this.getWikiLink(`Template:${itemId}`));
                            if (!response.ok) {
                                throw new Error('bad wiki link');
                            }
                            const pageContent = cheerio.load(await response.text());
                            const pathName = pageContent('.mw-parser-output p a').first().prop('href');
                            if (pathName) {
                                newWikiLink = `https://escapefromtarkov.fandom.com${pathName}`;
                            }
                        } catch (error){
                            // nothing to do
                        }
                    }

                    // We still don't have a wiki link, let's try to guess one
                    if (!newWikiLink) {
                        if (!item.types.includes('preset')) {
                            newWikiLink = this.getWikiLink(item.name);
                        } else {
                            const baseItem = this.items.get(item.properties.items[0]._tpl);
                            newWikiLink = this.getWikiLink(baseItem.name);
                        }

                        try {
                            const response = await fetch(newWikiLink, {method: 'HEAD'});
                            if (!response.ok) {
                                throw new Error('bad wiki link');
                            }
                        } catch (error) {
                            missingWikiLinkCount = missingWikiLinkCount + 1;
                            newWikiLink = false;
                            this.logger.warn(`${item.name} (${item.id}) missing wiki link`);
                        }
                    }

                    if (shouldRemoveCurrentLink && newWikiLink) {
                        shouldRemoveCurrentLink = false;
                    }

                    if (shouldRemoveCurrentLink && item.wiki_link) {
                        this.addJobSummary(item.name, 'Broken Wiki Link');
                        remoteData.setProperty(item.id, 'wiki_link', '');
                    }

                    if (newWikiLink) {
                        this.addJobSummary(item.name, 'Updated Wiki Link');
                        remoteData.setProperty(item.id, 'wiki_link', newWikiLink);
                    }
                } catch (error) {
                    this.addJobSummary(`${item.name} (${item.id}): ${error}`, 'Error checking wiki link');
                }
                resolve();
            }).finally(() => {
                jobs.delete(item.id);
            });
            jobs.set(item.id, checkWikiPromise);
        }
        await Promise.all(jobs.values());
        // Possibility to POST to a Discord webhook here with cron status details
        this.logger.log(`${missingWikiLinkCount} items still missing a valid wiki link`);
    }
}

export default VerifyWikiJob;
