const fs = require('fs');
const path = require('path');

//const bitcoinPrice = require('../modules/bitcoin-price');
const tarkovChanges = require('../modules/tarkov-changes');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');

module.exports = async (externalLogger) => {
    const logger = externalLogger || new JobLogger('update-bsg-data');
    try {
        logger.log('Loading bsg data');
        logger.time('item-data');
        const itemData = await tarkovChanges.items();
        logger.timeEnd('item-data');

        logger.time('bsg-translation-data');
        const localeData = await tarkovChanges.en();
        logger.timeEnd('bsg-translation-data');

        for(const key in itemData){
            if(!itemData[key]._props){
                continue;
            }

            itemData[key]._props = {
                ...itemData[key]._props,
                ...localeData.templates[key],
            };
        }

        logger.time('bsg-base-price-data');
        const creditsData = await tarkovChanges.credits();
        logger.timeEnd('bsg-base-price-data');

        for(const key in itemData){
            /*if (key === '59faff1d86f7746c51718c9c') {
                //bitcoin
                try {
                    itemData[key]._props = {
                        ...itemData[key]._props,
                        CreditsPrice: await bitcoinPrice()
                    };
                } catch (error) {
                    logger.error('Error setting bitcoin price', error);
                }
                continue;
            }*/
            if (!itemData[key]._props){
                continue;
            }

            itemData[key]._props = {
                ...itemData[key]._props,
                CreditsPrice: creditsData[key],
            };
        }
        
        const writeData = {};
        let allKeys = Object.keys(itemData);

        allKeys.sort();

        for(const key of allKeys){
            writeData[key] = itemData[key];
        }

        fs.writeFileSync(path.join(__dirname, '..', 'bsg-data.json'), JSON.stringify(writeData, null, 4));
    } catch (error) {
        logger.error(error);
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    if (!externalLogger) logger.end();
}