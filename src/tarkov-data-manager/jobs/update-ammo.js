const fs = require('fs');
const path = require('path');

const cloudflare = require('../modules/cloudflare');

const JobLogger = require('../modules/job-logger');
const {alert} = require('../modules/webhook');
const tarkovChanges = require('../modules/tarkov-changes');
const { query, jobComplete } = require('../modules/db-connection');

module.exports = async function() {
    const logger = new JobLogger('update-ammo');
    try {
        const items = await tarkovChanges.items();
        const en = (await tarkovChanges.en()).templates;
        const ammunition = {
            updated: new Date(),
            data: [],
        };
        const caliberCounts = {};
        logger.log('Processing ammo...');
        for (const id in items) {
            const ammo = items[id];
            if (ammo._parent !== '5485a8684bdc2da71d8b4567') {
                // not ammo
                continue;
            }
            if (!en[id]) {
                logger.warn(`No translation for ${ammo._name} (${id}) found in locale_en.json`);
                continue;
            }
            if (id === '6241c316234b593b5676b637') {
                // ignore airsoft bb
                continue;
            }
            ammunition.data.push({
                id: id,
                name: en[id].Name,
                shortName: en[id].ShortName,
                weight: ammo._props.Weight,
                caliber: ammo._props.Caliber,
                stackMaxSize: ammo._props.StackMaxSize,
                tracer: ammo._props.Tracer,
                tracerColor: ammo._props.TracerColor,
                ammoType: ammo._props.ammoType,
                projectileCount: ammo._props.ProjectileCount,
                damage: ammo._props.Damage,
                armorDamage: ammo._props.ArmorDamage,
                fragmentationChance: ammo._props.FragmentationChance,
                ricochetChance: ammo._props.RicochetChance,
                penetrationChance: ammo._props.PenetrationChance,
                penetrationPower: ammo._props.PenetrationPower,
                accuracy: ammo._props.ammoAccr,
                recoil: ammo._props.ammoRec,
                initialSpeed: ammo._props.InitialSpeed,
                heavyBleed: ammo._props.HeavyBleedingDelta,
                lightBleed: ammo._props.LightBleedingDelta
            });
            if (typeof caliberCounts[ammo._props.Caliber] === 'undefined') caliberCounts[ammo._props.Caliber] = 0;
            caliberCounts[ammo._props.Caliber]++;
        }
        const ammoIds = ammunition.data.map(ammo => `'${ammo.id}'`);
        const results = await query(`
            SELECT item_data.id FROM item_data
            LEFT JOIN types ON
                types.item_id = item_data.id
            WHERE NOT EXISTS (SELECT type FROM types WHERE item_data.id = types.item_id AND type = 'disabled')
            AND item_data.id IN (${ammoIds.join(', ')})
        `);
        const validIds = results.map(result => result.id);
        ammunition.data = ammunition.data.filter(ammo => validIds.includes(ammo.id));
        logger.log(`Processed ${ammunition.data.length} ammunition types`);
        for (const cal in caliberCounts) {
            logger.log(`${cal}: ${caliberCounts[cal]}`);
        }
        fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'ammo.json'), JSON.stringify(ammunition, null, 4));

        const response = await cloudflare(`/values/AMMO_DATA`, 'PUT', JSON.stringify(ammunition)).catch(error => {
            logger.error(error);
            return {success: false, errors: [], messages: []};
        });
        if (response.success) {
            logger.success('Successful Cloudflare put of AMMO_DATA');
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
    jobComplete();
};