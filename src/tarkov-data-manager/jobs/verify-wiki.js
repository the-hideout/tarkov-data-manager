const got = require('got');
const ora = require('ora');

const {connection} = require('../modules/db-connection');

const nameToWikiLink = (name) => {
    const formattedName = name
        .replace(/\s/g, '_')
        .replace(/&/, '%26')
        .replace(/'/, '%27');

    return `https://escapefromtarkov.fandom.com/wiki/${formattedName}`;
};

const postMessage = (spinner, id, name, link, type) => {
    const messageData = {
        title: `Broken wiki link for ${name}`,
        message: `Wiki link for ${name} does no longer work`,
        users: 'QBfmptGTgQoOS2gGOobd5Olfp31hTKrG',
    };

    if(link){
        messageData.url = link.replace( /_/g, '\\_' );
    }

    switch (type) {
        case 'new':
            spinner.succeed(`${id} | ${link} | ${name}`);

            messageData.title = `New wiki link for ${name}`;
            messageData.message = `Updated wiki link for ${name}`;

            break;
        case 'broken':
            spinner.fail(`${id} | ${link} | ${name}`);

            break;
    }

    got.post(`https://notifyy-mcnotifyface.herokuapp.com/out`, {
        json: messageData,
    });
};

module.exports = async () => {
    let missing = 0;
    const spinner = ora('Verifying wiki links').start();
    await new Promise((resolve, reject) => {
        connection.query(`select item_data.*, translations.value AS name from item_data, translations where translations.item_id = item_data.id and translations.type = 'name'`, async (error, results) => {
            if(error){
                return reject(error);
            }

            for(let i = 0; i < results.length; i = i + 1){
                const result = results[i];
                spinner.start(`${i + 1}/${results.length} ${result.name}`);

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
                        // postMessage(spinner, result.id, result.name, newWikiLink, 'broken');

                        missing = missing + 1;
                        newWikiLink = false;
                    }
                }

                if(shouldRemoveCurrentLink && result.wiki_link){
                    postMessage(spinner, result.id, result.name, newWikiLink, 'broken');
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        connection.query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, ['', result.id], (error) => {
                            if(error){
                                console.log(error);
                                return rejectUpdate(error);
                            }

                            return resolveUpdate();
                        });
                    });
                }

                if(newWikiLink){
                    postMessage(spinner, result.id, result.name, newWikiLink, 'new');
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        connection.query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, [newWikiLink, result.id], (error) => {
                            if(error){
                                console.log(error);
                                return rejectUpdate(error);
                            }

                            return resolveUpdate();
                        });
                    });
                }
            }

            spinner.stop();

            resolve();
        });
    });

    console.log(`${missing} items still missing a valid wiki link`);
};