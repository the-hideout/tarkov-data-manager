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
        this.missingWikiLinkCount = 0;
        const jobs = new Map();
        this.logger.log('Verifying wiki links');
        for (const item of this.items.values()) {
            while (jobs.size >= 2) {
                await sleep(100);
            }
            if (item.types.includes('disabled') || item.types.includes('quest')) {
                continue;
            }

            jobs.set(item.id, this.checkWikiLink(item).finally(() => {
                jobs.delete(item.id);
            }));
        }
        await Promise.all(jobs.values());
        // Possibility to POST to a Discord webhook here with cron status details
        this.logger.log(`${this.missingWikiLinkCount} items still missing a valid wiki link`);
    }

    async checkWikiLink(item) {
        try {
            let shouldRemoveCurrentLink = false;
            let newWikiLink = false;

            if (item.wiki_link) {
                try {
                    const pageName = item.wiki_link.split('/wiki/')[1];
                    const response = await this.getWikiApiPage(pageName).catch(error => {
                        if (error.code === 'missingtitle') {
                            shouldRemoveCurrentLink = true;
                            return Promise.reject(new Error('bad link'));
                        }
                        // request wasn't successful but wasn't a 404
                        // don't change anything
                        this.logger.log(`Error checking wiki link: ${error.status} ${error.statusText}`);
                        this.logger.log(`\t${item.name} ${item.id}`);
                        this.logger.log(`\t${item.wiki_link}`);
                        return {resolve: true};
                    });
                    if (response.resolve) {
                        return;
                    }
                    const pageContent = cheerio.load(response.parse.text['*']);
                    const redirect = pageContent('.mw-parser-output .redirectText li a').first().prop('href');

                    // We have the right link. Move on
                    if (!redirect) {
                        return;
                    }

                    // We don't have the right link, but there's a redirect
                    newWikiLink = `https://escapefromtarkov.fandom.com${redirect}`;
                    this.logger.log(`Link redirect: ${item.name} ${item.id}: ${newWikiLink}`);
                    this.logger.log(`\tOld: ${item.wiki_link}`);
                    this.logger.log(`\tNew: ${newWikiLink}`);
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
                    const response = await this.getWikiApiPage(`Template%3A${itemId}`);
                    const pageContent = cheerio.load(response.parse.text['*']);
                    const pathName = pageContent('.mw-parser-output p a').first().prop('href');
                    if (pathName) {
                        newWikiLink = `https://escapefromtarkov.fandom.com${pathName}`;
                        this.logger.log(`Link from ID: ${item.name} ${item.id}: ${newWikiLink}`);
                        this.logger.log(`\tNew: ${newWikiLink}`);
                    }
                } catch (error) {
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
                    const pageName = newWikiLink.split('/wiki/')[1];
                    const response = await this.getWikiApiPage(pageName);
                    const pageContent = cheerio.load(response.parse.text['*']);
                    const redirect = pageContent('.mw-parser-output .redirectText li a').first().prop('href');
                
                    if (redirect) {
                        newWikiLink = this.getWikiLink(redirect.replace('/wiki/', ''));
                        this.logger.log(`Link from name +redirect: ${item.name} ${item.id}: ${newWikiLink}`);
                    } else {
                        this.logger.log(`Link from name: ${item.name} ${item.id}: ${newWikiLink}`);
                    }
                    this.logger.log(`\tNew: ${newWikiLink}`);
                } catch (error) {
                    this.missingWikiLinkCount++;
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
                //this.logger.log(`Updated link: ${item.name} ${item.id}: ${newWikiLink}`);
                remoteData.setProperty(item.id, 'wiki_link', newWikiLink);
            }
        } catch (error) {
            this.addJobSummary(`${item.name} (${item.id}): ${error}`, 'Error checking wiki link');
        }
    }
}

export default VerifyWikiJob;
