const mysql = require('mysql');
const got = require('got');
const ora = require('ora');

const connection = mysql.createConnection({
    host     : 'tarkov-tools-master-1.cluster-c1vhfeufwkpn.eu-west-1.rds.amazonaws.com',
    user     : 'desktop1',
    password : process.env.MYSQL_PASSWORD,
    database : 'tarkov_tools',
});

connection.connect();

const nameToWikiLink = (name) => {
    const formattedName = name
        .replace(/\s/g, '_')
        .replace(/&/, '%26')
        .replace(/'/, '%27');

    return `https://escapefromtarkov.fandom.com/wiki/${formattedName}`;
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

                const newWikiLink = nameToWikiLink(result.name);

                try {
                    await got.head(result.wiki_link);

                    continue;
                } catch (requestError){
                    // do nothing
                    const messageData = {
                        title: `Broken wiki link for ${result.name}`,
                        message: `Wiki link for ${result.name} does no longer work`,
                        url: result.wiki_link.replace( /_/g, '\\_' ),
                        users: 'QBfmptGTgQoOS2gGOobd5Olfp31hTKrG',
                    };

                    got.post(`https://notifyy-mcnotifyface.herokuapp.com/out`, {
                        json: messageData,
                    });
                }

                try {
                    await got.head(newWikiLink);
                    // console.log(`${result.id} | ${newWikiLink} | ${result.name} | NEW`);
                    spinner.succeed(`${result.id} | ${newWikiLink} | ${result.name} | NEW`);

                    await new Promise((resolveUpdate, rejectUpdate) => {
                        connection.query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, [newWikiLink, result.id], (error) => {
                            if(error){
                                return rejectUpdate(error);
                            }

                            return resolveUpdate();
                        });
                    });
                } catch (requestError){
                    // console.log(`${result.id} | ${newWikiLink} | ${result.name} | FAILED`);
                    spinner.fail(`${result.id} | ${newWikiLink} | ${result.name} | FAILED`);
                    await new Promise((resolveUpdate, rejectUpdate) => {
                        connection.query(`UPDATE item_data SET wiki_link = ? WHERE id = ?`, ['', result.id], (error) => {
                            if(error){
                                return rejectUpdate(error);
                            }

                            return resolveUpdate();
                        });
                    });

                    missing = missing + 1;
                }

                const messageData = {
                    title: `New wiki link for ${result.name}`,
                    message: `Updated wiki link for ${result.name}`,
                    url: newWikiLink.replace( /_/g, '\\_' ),
                    users: 'QBfmptGTgQoOS2gGOobd5Olfp31hTKrG',
                };

                got.post(`https://notifyy-mcnotifyface.herokuapp.com/out`, {
                    json: messageData,
                });
            }

            spinner.stop();

            resolve();
        });
    });

    connection.end();
    console.log(`${missing} items still missing a valid wiki link`);
};