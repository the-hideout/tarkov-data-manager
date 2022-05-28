const fs = require('fs');
const path = require('path');

const got = require('got');
const cloudflare = require('../modules/cloudflare');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');

module.exports = async function() {
    const logger = new JobLogger('update-traders');
    try {
        logger.log('Loading trader data from Tarkov-Changes...');
        const tradersData = await tarkovChanges.traders();
        logger.log('Loading en from Tarkov-Changes...');
        const en = await tarkovChanges.locale_en();
        const locales = await tarkovChanges.locales();
        logger.log('Loading TarkovData traders.json...');
        const tdTraders = (await got('https://github.com/TarkovTracker/tarkovdata/raw/master/traders.json', {
            responseType: 'json',
        })).body;
        const traders = {
            updated: new Date(),
            data: [],
        };
        logger.log('Processing traders...');
        for (const traderId in tradersData) {
            const trader = tradersData[traderId];
            const date = new Date(trader.nextResupply*1000);
            //date.setHours(date.getHours() +5);
            const traderData = {
                id: trader._id,
                name: en.trading[trader._id].Nickname,
                currency: trader.currency,
                resetTime: date,
                discount: parseInt(trader.discount) / 100,
                levels: [],
                locale: {}
            };
            if (!en.trading[trader._id]) {
                logger.warn(`No trader id ${trader._id} found in locale_en.json`);
                traderData.name = trader.nickname;
            }
            for (const code in locales) {
                const lang = locales[code];
                if (!lang.trading[trader._id]) {
                    logger.warn(`No trader id ${trader._id} found in ${code} translation`);
                    traderData.name = trader.nickname;
                } else {
                    traderData.locale[code] = {name: lang.trading[trader._id].Nickname};
                }
            }
            logger.log(`${traderData.name} ${trader._id}`);
            for (let i = 0; i < trader.loyaltyLevels.length; i++) {
                const level = trader.loyaltyLevels[i];
                if (trader._id == '579dc571d53a0658a154fbec' &&traderData.levels.length === 0) {
                    i--;
                }
                const levelData = {
                    id: `${trader._id}-${i+1}`,
                    name: traderData.name,
                    level: i+1,
                    requiredPlayerLevel: parseInt(level.minLevel),
                    requiredReputation: parseInt(level.minStanding),
                    requiredCommerce: parseInt(level.minSalesSum),
                    payRate: (100 - level.buy_price_coef) / 100,
                    insuranceRate: null,
                    repairCostMultiplier: null
                };
                if (trader.insurance.availability){
                    levelData.insuranceRate = parseInt(level.insurance_price_coef) / 100;
                }
                if (trader.repair.availability) {
                    levelData.repairCostMultiplier = 1 + (parseInt(level.repair_price_coef) / 100);
                }
                traderData.levels.push(levelData);
            }
            if (tdTraders[traderData.name.toLowerCase()]) {
                traderData.tarkovDataId = tdTraders[traderData.name.toLowerCase()].id;
            }
            traders.data.push(traderData);
        }
        logger.log(`Processed ${traders.data.length} traders`);
    
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'traders.json'), JSON.stringify(traders, null, 4));

        const response = await cloudflare(`/values/TRADER_DATA_V2`, 'PUT', JSON.stringify(traders)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of TRADER_DATA');
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
        alert({
            title: `Error running ${logger.jobName} job`,
            message: error.toString()
        });
    }
    logger.end();
};