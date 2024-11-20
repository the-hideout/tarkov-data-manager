// imports new items from the game data

import DataJob from '../modules/data-job.mjs';
import remoteData from '../modules/remote-data.mjs';
import tarkovData from '../modules/tarkov-data.mjs';

class UpdateNewItemsJob extends DataJob {
    constructor(options) {
        super({...options, name: 'update-new-items'});
    }

    run = async () => {
        const [currentItems, bsgData, en] = await Promise.all([
            remoteData.get(),
            tarkovData.items(),
            tarkovData.locale('en'),
        ]);

        this.logger.log('Checking for new items');

        const items = Object.values(bsgData).filter((bsgObject) => {
            if (!bsgObject._props) {
                return false;
            }

            if (bsgObject._type !== 'Item') {
                return false;
            }

            if (ignoreMap.includes(bsgObject._id)) {
                return false;
            }

            // Parent is LootContainer
            if (bsgObject._parent === '566965d44bdc2d814c8b4571') {
                return false;
            }

            // Parent is MobContainer (secure containers)
            if (bsgObject._parent === '5448bf274bdc2dfc2f8b456a') {
                // skip secure containers that are too big
                return !bsgObject._props.Grids.some(grid => grid._props.cellsH >= 10 || grid._props.cellsV >= 10);
            }

            // Parent is Stash
            if (bsgObject._parent === '566abbb64bdc2d144c8b457d') {
                return false;
            }

            // Parent is Pockets
            if (bsgObject._parent === '557596e64bdc2dc2118b4571') {
                return false;
            }

            // Parent is Inventory
            if (bsgObject._parent === '55d720f24bdc2d88028b456d') {
                return false;
            }

            // Parent is Sorting table
            if (bsgObject._parent === '6050cac987d3f925bf016837') {
                return false;
            }

            // Parent is HideoutAreaContainer
            if (bsgObject._parent === '63da6da4784a55176c018dba') {
                return false;
            }

            // skip built-in armor plates
            if (bsgObject._parent === '65649eb40bf0ed77b8044453') {
                return false;
            }

            // 5b9b9020e7ef6f5716480215 dogtagt

            // Removes shrapnel etc
            if (bsgObject._props.StackMinRandom === 0) {
                return false;
            }

            // skip 999-round zombie magazines
            if (bsgObject._parent === '5448bc234bdc2d3c308b4569' || bsgObject._parent === '610720f290b75a49ff2e5e25') {
                return !bsgObject._props.Cartridges.some(cart => cart._max_count === 999);
            }

            return true;
        });

        const foundItems = [];

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
            if (name.match(doNotUse) || name === '') continue;
            if (shortname === '') continue;
            const normalized = this.normalizeName(name);

            try {
                await remoteData.addItem({
                    id: item._id,
                    name: name,
                    short_name: shortname,
                    normalized_name: normalized,
                    width: item._props.Width,
                    height: item._props.Height,
                    properties: {backgroundColor: item._props.BackgroundColor},
                });

                console.log(`${name} added`);
                this.addJobSummary(`${name} ${item._id}`, 'Added Items');

                if (item._props.QuestItem){
                    await remoteData.addType(item._id, 'quest')
                }
            } catch (error){
                this.logger.fail(`${name} ${item._id} error updating item`);
                this.logger.error(error);
                this.logger.end();
                return Promise.reject(error);
            }
        }

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
            this.logger.warn(`${item.name} (${item.id}) is no longer available in the game`);
            this.addJobSummary(`${item.name} ${item.id}`, 'Removed Items');
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

export default UpdateNewItemsJob;
