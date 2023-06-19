// imports new items from the game data

const normalizeName = require('../modules/normalize-name');
const remoteData = require('../modules/remote-data');
//const oldShortnames = require('../old-shortnames.json');

const tarkovData = require('../modules/tarkov-data');
const DataJob = require('../modules/data-job');

class UpdateNewItemsJob extends DataJob {
    constructor() {
        super('update-new-items');
    }

    run = async () => {
        const [currentItems, bsgData, en] = await Promise.all([
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
        ]);

        this.logger.log('Checking for new items');

        const items = Object.values(bsgData).filter((bsgObject) => {
            if(!bsgObject._props){
                return false;
            }

            if(bsgObject._type !== 'Item'){
                return false;
            }

            if(secureContainers.includes(bsgObject._id)){
                return true;
            }

            if(ignoreMap.includes(bsgObject._id)){
                return false;
            }

            // Parent is LootContainer
            if(bsgObject._parent === '566965d44bdc2d814c8b4571'){
                return false;
            }

            // Parent is MobContainer
            // Removes all secure containers, which is why we do the above check first
            if(bsgObject._parent === '5448bf274bdc2dfc2f8b456a'){
                return false;
            }

            // Parent is Stash
            if(bsgObject._parent === '566abbb64bdc2d144c8b457d'){
                return false;
            }

            // Parent is Pockets
            if(bsgObject._parent === '557596e64bdc2dc2118b4571'){
                return false;
            }

            // Parent is Inventory
            if(bsgObject._parent === '55d720f24bdc2d88028b456d'){
                return false;
            }

            // Parent is Sorting table
            if(bsgObject._parent === '6050cac987d3f925bf016837'){
                return false;
            }

            // 5b9b9020e7ef6f5716480215 dogtagt

            // Removes shrapnel etc
            if(bsgObject._props.StackMinRandom === 0){
                return false
            }

            return true;
        });

        const foundItems = [];
        const addedItems = [];

        const doNotUse = /DO[ _]NOT[ _]USE|translation_pending/;
        for (const item of items) {
            // Skip existing items to speed things up
            if (currentItems.has(item._id)){
                foundItems.push(item._id);
                continue;
            }

            let name = item._props.Name.trim();
            let shortname = '';
            name = en[`${item._id} Name`] || name;
            shortname = en[`${item._id} ShortName`] || shortname;
            name = String(name).trim();
            shortname = String(shortname).trim();
            if (name.match(doNotUse)) continue;
            const normalized = normalizeName(name);

            try {
                const results = await remoteData.addItem({
                    id: item._id,
                    name: name,
                    short_name: shortname,
                    normalized_name: normalized,
                    width: item._props.Width,
                    height: item._props.Height,
                    properties: {backgroundColor: item._props.BackgroundColor},
                });
                if (results.affectedRows > 0){
                    console.log(`${name} updated`);
                }

                if (results.insertId !== 0){
                    console.log(`${name} added`);
                    addedItems.push(`${name} ${item._id}`);
                }

                if (item._props.QuestItem){
                    await remoteData.addType(item._id, 'quest')
                }
            } catch (error){
                this.logger.fail(`${name} error updating item`);
                this.logger.error(error);
                this.logger.end();
                return Promise.reject(error);
            }
        }

        if (addedItems.length > 0) {
            await this.discordAlert({
                title: 'New item(s) added',
                message: addedItems.join('\n'),
            });
        }

        const removedItems = [];
        for (const itemId of currentItems.keys()){
            if (bsgData[itemId]) {
                continue;
            }
            const item = currentItems.get(itemId);
            if (item.types.includes('preset')) {
                continue;
            }
            if (item.types.includes('disabled')) {
                continue;
            }
            removedItems.push(item);
            this.logger.warn(`${item.name} (${item.id}) is no longer available in the game`);
        }
        if (removedItems.length > 0) {
            await this.discordAlert({
                title: `Item(s) removed from game`,
                message: removedItems.map(item => `${item.name} ${item.id}`).join('\n'),
            });
        }

        this.logger.succeed('New item check complete');
    }
}

const ignoreMap = [
    '5447bed64bdc2d97278b4568', // AGS 30x29 mm automatic grenade launcher
    '5d52cc5ba4b9367408500062', // AGS 30x29 mm automatic grenade launcher
    '5d52d479a4b936793d58c76b', // AGS-30 30-Grenades box 30x29
    '58ac60eb86f77401897560ff', // Balaclava_dev
    '59e8936686f77467ce798647', // Balaclava_test
    '5cdeb229d7f00c000e7ce174', // NSV "Utes" 12.7x108 machine gun
    '5d53f4b7a4b936793d58c780', // PAG-17 scope
    '5cde8864d7f00c0010373be1', // 12.7x108 mm B-32
    '5d2f2ab648f03550091993ca', // 12.7x108 mm BZT-44M
    '5cffa483d7ad1a049e54ef1c', // 100 rounds belt
    '56e294cdd2720b603a8b4575', // Mystery Ranch Terraplane Backpack
    '590de52486f774226a0c24c2', // Weird machinery key
    '5e85aac65505fa48730d8af2', // patron_12,7x55_ps12
    '5f647fd3f6e4ab66c82faed6', // patron_23x75_shrapnel_10
    '5675838d4bdc2d95058b456e', // Drawer
    '602543c13fee350cd564d032', // Sorting table
    '5751961824597720a31c09ac', // (off)black keycard
];

const secureContainers = [
    '544a11ac4bdc2d470e8b456a', // alpha
    '5857a8b324597729ab0a0e7d', // beta
    '59db794186f77448bc595262', // epsilon
    '5857a8bc2459772bad15db29', // gamma
    '5c093ca986f7740a1867ab12', // kappa
    '5732ee6a24597719ae0c0281', // waist pouch
];

module.exports = UpdateNewItemsJob;
