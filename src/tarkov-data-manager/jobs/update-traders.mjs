import got from 'got';

import DataJob from '../modules/data-job.mjs';
import tarkovData from '../modules/tarkov-data.mjs';
import s3 from '../modules/upload-s3.mjs';
import tarkovChanges from '../modules/tarkov-changes.mjs';

class UpdateTradersJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-traders', loadLocales: true});
        this.kvName = 'trader_data';
    }

    async run() {
        this.logger.log('Loading TarkovData traders.json and services status...');
        [this.tdTraders, this.services] = await Promise.all([
            got('https://github.com/TarkovTracker/tarkovdata/raw/master/traders.json', {
                responseType: 'json',
                resolveBodyOnly: true,
            }),
            tarkovData.status().then(status => status.services).catch(error => {
                this.logger.error(`Error getting EFT services status: ${error.message}`);
                return [];
            })
        ]);
        const tradingService = this.services.find(s => s.name === 'Trading');
        const gameUpdating = tradingService?.status === 1;
        const skipTraders = {
            pve: ['6617beeaa9cfa777ca915b7c'] // Ref
        };
        this.kvData = {};
        const s3Images = s3.getLocalBucketContents();
        const staleTraderInterval = 1000 * 60 * 15;
        for (const gameMode of this.gameModes) {
            this.logger.log(`Processing ${gameMode.name} traders...`);
            [this.tradersData, this.globals] = await Promise.all([
                tarkovData.traders({gameMode: gameMode.name}),
                tarkovData.globals({gameMode: gameMode.name}),
            ]);
            this.kvData[gameMode.name] = {
                Trader: []
            };
            let staleTraderCount = 0;
            for (const traderId in this.tradersData) {
                if (skipTraders[gameMode.name]?.includes(traderId)) {
                    continue;
                }
                const trader = this.tradersData[traderId];
                const date = new Date(trader.nextResupply*1000);
                //date.setHours(date.getHours() +5);
                const traderData = {
                    id: trader._id,
                    name: this.addTranslation(`${trader._id} Nickname`),
                    description: this.addTranslation(`${trader._id} Description`),
                    normalizedName: this.normalizeName(this.locales.en[`${trader._id} Nickname`]),
                    currency: trader.currency,
                    resetTime: date,
                    discount: parseInt(trader.discount) / 100,
                    levels: [],
                    reputationLevels: [],
                    items_buy: trader.items_buy,
                    items_buy_prohibited: trader.items_buy_prohibited,
                    imageLink: `https://${process.env.S3_BUCKET}/unknown-trader.webp`,
                    image4xLink: `https://${process.env.S3_BUCKET}/unknown-trader-4x.webp`,
                };
                if (traderData.id === this.globals.config.FenceSettings.FenceId) {
                    for (const minRepLevel in this.globals.config.FenceSettings.Levels) {
                        const lvl = this.globals.config.FenceSettings.Levels[minRepLevel];
                        traderData.reputationLevels.push({
                            __typename: 'TraderReputationLevelFence',
                            minimumReputation: parseInt(minRepLevel),
                            scavCooldownModifier: lvl.SavageCooldownModifier,
                            scavCaseTimeModifier: lvl.ScavCaseTimeModifier,
                            extractPriceModifier: lvl.ExfiltrationPriceModifier,
                            scavFollowChance: lvl.BotFollowChance / 100,
                            scavEquipmentSpawnChanceModifier: lvl.ScavEquipmentSpawnChanceModifier,
                            priceModifier: lvl.PriceModifier,
                            hostileBosses: lvl.HostileBosses,
                            hostileScavs: lvl.HostileScavs,
                            scavAttackSupport: lvl.ScavAttackSupport,
                            availableScavExtracts: lvl.AvailableExits,
                            btrEnabled: lvl.CanInteractWithBtr,
                            btrDeliveryDiscount: lvl.PriceModDelivery,
                            btrDeliveryGridSize: lvl.DeliveryGridSize,
                            btrTaxiDiscount: lvl.PriceModTaxi,
                            btrCoveringFireDiscount: lvl.PriceModCleanUp,
                        });
                    }
                    traderData.reputationLevels.sort((a, b) => {
                        return a.minimumReputation - b.minimumReputation;
                    });
                }
                if (s3Images.includes(`${traderData.id}.webp`)) {
                    traderData.imageLink = `https://${process.env.S3_BUCKET}/${traderData.id}.webp`;
                }
                if (s3Images.includes(`${traderData.id}-4x.webp`)) {
                    traderData.image4xLink = `https://${process.env.S3_BUCKET}/${traderData.id}-4x.webp`;
                }
                if (!this.locales.en[`${trader._id} Nickname`]) {
                    this.logger.warn(`No trader id ${trader._id} found in locale_en.json`);
                    traderData.name = trader.nickname;
                    traderData.normalizedName = this.normalizeName(trader.nickname);
                }
                this.logger.log(`✔️ ${this.locales.en[traderData.name]} ${trader._id}`);
                this.logger.log(`   - Restock: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
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
                        repairCostMultiplier: null,
                        imageLink: `https://${process.env.S3_BUCKET}/unknown-trader.webp`,
                        image4xLink: `https://${process.env.S3_BUCKET}/unknown-trader-4x.webp`,
                    };
                    if (trader.insurance.availability){
                        levelData.insuranceRate = parseInt(level.insurance_price_coef) / 100;
                    }
                    if (trader.repair.availability) {
                        levelData.repairCostMultiplier = 1 + (parseInt(level.repair_price_coef) / 100);
                    }
                    if (s3Images.includes(`${traderData.id}-${levelData.level}.webp`)) {
                        levelData.imageLink = `https://${process.env.S3_BUCKET}/${traderData.id}-${levelData.level}.webp`;
                    }
                    if (s3Images.includes(`${traderData.id}-${levelData.level}-4x.webp`)) {
                        levelData.image4xLink = `https://${process.env.S3_BUCKET}/${traderData.id}-${levelData.level}-4x.webp`;
                    }
                    traderData.levels.push(levelData);
                }
                this.logger.log(`   - Levels: ${traderData.levels.length}`);
                if (this.tdTraders[traderData.name.toLowerCase()]) {
                    traderData.tarkovDataId = this.tdTraders[traderData.name.toLowerCase()].id;
                }
                this.kvData[gameMode.name].Trader.push(traderData);
                if (date < new Date() && new Date() - date > staleTraderInterval) {
                    staleTraderCount++;
                }
            }
            this.logger.log(`Processed ${this.kvData[gameMode.name].Trader.length} ${gameMode.name} traders`);

            if (staleTraderCount > 0 && !gameUpdating) {
                this.logger.warn(`${staleTraderCount} stale traders; triggering restart`);
                this.addJobSummary(`${staleTraderCount} stale ${gameMode.name} traders`);
                await tarkovChanges.restart().catch(error => {
                    this.logger.warn(`Error triggering TC restart: ${error.message}`);
                });
            }
    
            let kvName = this.kvName;
            if (gameMode.name !== 'regular') {
                kvName += `_${gameMode.name}`;
            }
            await this.cloudflarePut(this.kvData[gameMode.name], kvName);
        }
        return this.kvData;
    }
}

export default UpdateTradersJob;
