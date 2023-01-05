const got = require('got');

const cloudflare = require('../modules/cloudflare');
const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovData = require('../modules/tarkov-data');
const normalizeName = require('../modules/normalize-name');
const { setLocales, getTranslations } = require('../modules/get-translation');

module.exports = async function(externalLogger) {
    const logger = externalLogger || new JobLogger('update-traders');
    try {
        logger.log('Loading trader data...');
        const tradersData = await tarkovData.traders();
        logger.log('Loading locales...');
        const locales = await tarkovData.locales();
        setLocales(locales);
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
                name: locales.en[`${trader._id} Nickname`],
                normalizedName: normalizeName(locales.en[`${trader._id} Nickname`]),
                currency: trader.currency,
                resetTime: date,
                discount: parseInt(trader.discount) / 100,
                levels: [],
                locale: getTranslations({
                    name: `${trader._id} Nickname`,
                    description: `${trader._id} Description`,
                }, logger),
                items_buy: trader.items_buy,
                items_buy_prohibited: trader.items_buy_prohibited,
            };
            if (!locales.en[`${trader._id} Nickname`]) {
                logger.warn(`No trader id ${trader._id} found in locale_en.json`);
                traderData.name = trader.nickname;
                traderData.normalizedName = normalizeName(trader.nickname);
            }
            logger.log(`✔️ ${traderData.name} ${trader._id}`);
            logger.log(`   - Restock: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
            for (let i = 0; i < trader.loyaltyLevels.length; i++) {
                const level = trader.loyaltyLevels[i];
                if (trader._id == '579dc571d53a0658a154fbec' && traderData.levels.length === 0) {
                    i--;
                }
                const buyCoef = parseInt(level.buy_price_coef);
                const levelData = {
                    id: `${trader._id}-${i+1}`,
                    name: traderData.name,
                    level: i+1,
                    requiredPlayerLevel: parseInt(level.minLevel),
                    requiredReputation: parseFloat(level.minStanding),
                    requiredCommerce: parseInt(level.minSalesSum),
                    payRate: buyCoef ? (100 - buyCoef) / 100 : 0.0001,
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
            logger.log(`   - Levels: ${traderData.levels.length}`);
            if (tdTraders[traderData.name.toLowerCase()]) {
                traderData.tarkovDataId = tdTraders[traderData.name.toLowerCase()].id;
            }
            traders.data.push(traderData);
        }
        logger.log(`Processed ${traders.data.length} traders`);

        const response = await cloudflare.put('trader_data', JSON.stringify(traders)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of trader_data');
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