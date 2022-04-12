const got = require('got');

const {query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');

module.exports = async () => {
    let presets;
    const logger = new JobLogger('update-presets');
    logger.log('Updating presets');
    try {
        // const response = await got('https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/globals.json', {
        //     responseType: 'json',
        // });

        const response = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/item_presets.json', {
            responseType: 'json',
        });

        presets = response.body;
    } catch (requestError){
        logger.error(requestError);
    }

    for(const presetId in presets){
        // Skip non-default presets for now
        if(!presets[presetId].default){
            continue;
        }
        let i = 0;
        for(const item of presets[presetId].parts){
            i = i + 1;

            //logger.log(`Adding item ${i}/${presets[presetId].parts.length} for ${presets[presetId].name}`);

            // Skip the "container item"
            if(item.id === presets[presetId].baseId){
                continue;
            }

            await query(`
                INSERT IGNORE INTO 
                    item_children (container_item_id, child_item_id, count)
                VALUES (?, ?, ?)
            `, [presets[presetId].baseId, item.id, 1]);
        }
        logger.succeed(`Completed ${presets[presetId].name} preset (${presets[presetId].parts.length} parts)`);
    }

    logger.end();
    await jobComplete();
};