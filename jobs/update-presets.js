const got = require('got');

const connection = require('../modules/db-connection');

module.exports = async () => {
    let presets;
    try {
        const response = await got('https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/globals.json', {
            responseType: 'json',
        });

        presets = response.body.ItemPresets;
    } catch (requestError){
        console.error(requestError);
    }

    for(const presetId in presets){
        if(!presets[presetId]._name.toLowerCase().includes(' default') && !presets[presetId]._name.toLowerCase().includes('_std')){
            continue;
        }

        let i = 0;
        for(const item of presets[presetId]._items){
            i = i + 1;

            console.log(`Adding item ${i}/${presets[presetId]._items.length} for ${presets[presetId]._name} ${presets[presetId]._encyclopedia}`);

            if(item._tpl === presets[presetId]._encyclopedia){
                continue;
            }

            const promise = new Promise((resolve, reject) => {
                connection.query(`INSERT IGNORE INTO item_children (container_item_id, child_item_id, count)
                    VALUES (
                        ?,
                        ?,
                        ?
                    )`, [presets[presetId]._encyclopedia, item._tpl, 1], async (error, results) => {
                        if (error) {
                            reject(error)
                        }

                        resolve();
                    }
                );
            });

            try {
                await promise;
            } catch (upsertError){
                console.error(upsertError);

                throw upsertError;
            }
        }
    }

    console.log('Done with all presets');
};