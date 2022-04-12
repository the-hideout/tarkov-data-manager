const fs = require('fs');
const path = require('path');

const jsonDiff = require('json-diff');

const cloudflare = require('../modules/cloudflare');
//const christmasTreeCrafts = require('../public/data/christmas-tree-crafts.json');

const JobLogger = require('../modules/job-logger');
const tarkovChanges = require('../modules/tarkov-changes');

module.exports = async function() {
    const logger = new JobLogger('update-crafts');
    try {
        logger.log('Downloading item data from Tarkov-Changes...');
        const items = await tarkovChanges.items();
        logger.log('Downloading crafts from Takov-Changes...');
        const json = await tarkovChanges.crafts();
        logger.log('Downloading en from Tarkov-Changes...');
        const en = await tarkovChanges.en();
        const crafts = {
            updated: new Date(),
            data: [],
        };
        for (const id in json) {
            const craft = json[id];
            if (!en.templates[craft.endProduct]) {
                logger.warn(`No end product item with id ${craft.endProduct} found in locale_en.json`);
                continue;
            }
            if (!en.interface[`hideout_area_${craft.areaType}_name`]) {
                logger.warn(`No hideout station of type ${craft.areaType} found in locale_en.json`);
                continue;
            }
            const craftData = {
                id: id,
                requiredItems: [],
                rewardItems: [{
                    name: en.templates[craft.endProduct].Name,
                    id: craft.endProduct,
                    count: craft.count
                }],
                station: en.interface[`hideout_area_${craft.areaType}_name`],
                duration: craft.productionTime
            };
            for (index in craft.requirements) {
                const req = craft.requirements[index];
                if (req.type === 'Area') {
                    craftData.station = craftData.station + ' level '+req.requiredLevel;
                } else if (req.type === 'Resource') {
                    if (!en.templates[req.templateId]) {
                        logger.warn(`No requirement resource with id ${req.templateId} found in locale_en.json`);
                        continue;
                    }
                    if (!items[req.templateId]) {
                        logger.warn(`No requirement resource with id ${req.templateId} found in items.json`);
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: en.templates[req.templateId].Name,
                        id: req.templateId,
                        count: req.resource / items[req.templateId]._props.Resource,
                        attributes: []
                    });
                } else if (req.type === 'Item') {
                    if (!en.templates[req.templateId]) {
                        logger.warn(`No requirement item with id ${req.templateId} found in locale_en.json`);
                        continue;
                    }
                    craftData.requiredItems.push({
                        name: en.templates[req.templateId].Name,
                        id: req.templateId,
                        count: req.count
                    });
                }
            }
            crafts.data.push(craftData);
        }

        let beforeData = '{}';
        try {
            beforeData = fs.readFileSync(path.join(__dirname, '..', 'dumps', 'crafts.json'));
        } catch (openError){
            // Do nothing
        }
    
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'crafts.json'), JSON.stringify(crafts, null, 4));
    
        // console.log('DIFF');
        // console.log(jsonDiff.diff(JSON.parse(beforeData), crafts));
        // console.log();
        // console.log('DIFFJSON');
        // console.log(JSON.stringify(jsonDiff.diff(JSON.parse(beforeData), crafts), null, 4));
        // console.log();
        logger.log('DIFFString');
        logger.log(jsonDiff.diffString(JSON.parse(beforeData), crafts));

        const response = await cloudflare(`/values/CRAFT_DATA`, 'PUT', JSON.stringify(crafts)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of CRAFT_DATA');
        } else {
            for (let i = 0; i < response.errors.length; i++) {
                logger.error(response.errors[i]);
            }
            for (let i = 0; i < response.messages.length; i++) {
                logger.error(response.messages[i]);
            }
        }
        // Possibility to POST to a Discord webhook here with cron status details
    } catch (error) {
        logger.error(error);
    }
    logger.end();
};