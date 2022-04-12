const got = require('got');
const webhook = require('../modules/webhook');

const {query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

let logger = false;

const nameToWikiLink = (name) => {
    const formattedName = name
        .replace(/\s/g, '_')
        .replace(/&/, '%26')
        .replace(/'/, '%27');

    return `https://escapefromtarkov.fandom.com/wiki/${formattedName}`;
};

const postMessage = (item, foundNewLink) => {
    const messageData = {
        title: 'Broken wiki link',
        message: item.name
    };

    if (foundNewLink) {
        logger.succeed(`${item.id} | ${foundNewLink} | ${item.name}`);

        messageData.title = 'Updated wiki link';
        messageData.message = item.name;
    } else {
        logger.fail(`${item.id} | ${foundNewLink} | ${item.name}`);
    }

    webhook.alert(messageData);
};

module.exports = async () => {
    let logger = new JobLogger('verify-wiki');
    try {
        let missing = 0;
        logger.log('Verifying wiki links');
        const results = await query(`
            SELECT 
                item_data.*, translations.value AS name 
            FROM 
                item_data, translations 
            WHERE 
                translations.item_id = item_data.id AND translations.type = 'name'
        `);
        for(let i = 0; i < results.length; i = i + 1){
            const result = results[i];
            //logger.log(`${i + 1}/${results.length} ${result.name}`);

            let shouldRemoveCurrentLink = false;
            let newWikiLink = false;

            if(result.wiki_link){
                try {
                    const currentPage = await got(result.wiki_link);
                    const matches = currentPage.body.match(/rel="canonical" href="(?<canonical>.+)"/);

                    // We have the right link. Move on
                    if(matches.groups.canonical === result.wiki_link){
                        continue;
                    }

                    // We don't have the right link, but there's a redirect
                    newWikiLink = matches.groups.canonical;
                } catch (requestError){
                    // console.log(requestError);
                    shouldRemoveCurrentLink = true;
                }
            }

            // We don't have a wiki link, let's try retrieving from the id
            if(!newWikiLink){
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
                newWikiLink = nameToWikiLink(result.name);

                try {
                    await got.head(newWikiLink);
                } catch (requestError){
                    // console.log(requestError);
                    // postMessage(result.id, result.name, newWikiLink, 'broken');

                    missing = missing + 1;
                    newWikiLink = false;
                }
            }

            if (shouldRemoveCurrentLink && newWikiLink) {
                shouldRemoveCurrentLink = false;
            }

            if(shouldRemoveCurrentLink && result.wiki_link){
                postMessage(result, newWikiLink);
                await query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, ['', result.id]);
            }

            if(newWikiLink){
                postMessage(result, newWikiLink);
                await query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, [newWikiLink, result.id]);
            }
        }
        // Possibility to POST to a Discord webhook here with cron status details
        logger.log(`${missing} items still missing a valid wiki link`);
    } catch (error) {
        logger.error(error);
    }
    logger.end();
    await jobComplete();
};