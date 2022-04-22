const got = require('got');

const {query, jobComplete} = require('../modules/db-connection');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async () => {
    const logger = new JobLogger('update-presets-legacy');
    try {
        logger.log('Updating presets');
        // const response = await got('https://dev.sp-tarkov.com/SPT-AKI/Server/raw/branch/development/project/assets/database/globals.json', {
        //     responseType: 'json',
        // });

        const response = await got('https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/item_presets.json', {
            responseType: 'json',
        });

        const presets = response.body;

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
    } catch (error){
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
    await jobComplete();
};