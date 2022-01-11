const fs = require('fs');
const path = require('path');

const doQuery = require('../modules/do-query');

const keys = {
    interchange: {
        "OLI logistics department office key": "5ad5cfbd86f7742c825d6104",
        "ULTRA medical storage key": "5e42c71586f7747f245e1343",
        "NecrusPharm pharmacy key": "5ad5d64486f774079b080af8",
        "Kiba Arms outer door key": "5ad5d7d286f77450166e0a89",
        "Kiba Arms inner grate door key": "5addaffe86f77470b455f900",
        "EMERCOM medical unit key": "5ad5db3786f7743568421cce",
        "OLI cash register key": "5ad7217186f7746744498875",
        "IDEA cash register key": "5ad7242b86f7740a6a3abd43",
        "Goshan cash register key": "5ad7247386f7747487619dc3",
        "Object #21WS keycard": "5e42c83786f7742a021fdf3c",
        "Object #11SR keycard": "5e42c81886f7742a01529f57"
    },
    labs: {
        "TerraGroup Labs arsenal storage room key": "5c1f79a086f7746ed066fb8f",
        "TerraGroup Labs manager's office room key": "5c1e2a1e86f77431ea0ea84c",
        "TerraGroup Labs weapon testing area key": "5c1e2d1f86f77431e9280bee",
        "TerraGroup Labs keycard (Yellow)": "5c1d0d6d86f7744bb2683e1f",
        "TerraGroup Labs keycard (Violet)": "5c1e495a86f7743109743dfb",
        "TerraGroup Labs keycard (Blue)": "5c1d0c5f86f7744bb2683cf0",
        "TerraGroup Labs keycard (Red)": "5c1d0efb86f7744baf2e7b7b"
    },
    reserve: {
        "RB-MP11 key": "5d80c93086f7744036212b41",
        "RB-VO marked key": "5d80c62a86f7744036212b3f",
        "RB-PSV2 key": "5d95d6be86f77424444eb3a7",
        "RB-KORL key": "5d8e0db586f7744450412a42",
        "RB-AK key": "5d80c78786f774403a401e3e",
        "RB-ORB3 key": "5d80cd1a86f77402aa362f42",
        "RB-PSP1 key": "5d80cb3886f77440556dbf09",
        "RB-KSM key": "5d947d4e86f774447b415895",
        "RB-MP22 key": "5d80cab086f77440535be201",
        "RB-PSV1 key": "5d80cb5686f77440545d1286",
        "RB-RH key": "5da5cdcd86f774529238fb9b",
        "RB-KPRL key": "5d8e0e0e86f774321140eb56",
        "RB-MP13 key": "5d80cbd886f77470855c26c2",
        "RB-RLSA key": "5ede7b0c6d23e5473e6e8c66",
        "RB-PP key": "5d80cb8786f774405611c7d9",
        "RB-MP12 key": "5d80c95986f77440351beef3",
        "RB-AM key": "5d80c88d86f77440556dbf07",
        "RB-BK marked key": "5d80c60f86f77440373c4ece",
        "RB-RS key": "5da46e3886f774653b7a83fe",
        "RB-PSP2 key": "5d95d6fa86f77424484aa5e9",
        "RB-PKPM marked key": "5ede7a8229445733cb4c18e2",
        "RB-TB key": "5d80c6fc86f774403a401e3c",
        "RB-ORB2 key": "5d80ccdd86f77474f7575e02",
        "RB-ORB1 key": "5d80ccac86f77470841ff452",
        "RB-AO key": "5d80c66d86f774405611c7d6",
        "RB-MP21 key": "5d80ca9086f774403a401e40",
        "RB-GN key": "5d8e3ecc86f774414c78d05e",
        "RB-OB key": "5d80c6c586f77440351beef1",
        "RB-OP key": "5d80c8f586f77440373c4ed0",
        "RB-SMP key": "5d947d3886f774447b415893"
    },
    shoreline: {
        "104": "5a0dc45586f7742f6b0b73e3",
        "107": "5a0ea64786f7741707720468",
        "108": "5a0ea69f86f7741cd5406619",
        "112": "5a0ea69f86f7741cd5406619",
        "203": "5a0ea69f86f7741cd5406619",
        "205": "5a0ec6d286f7742c0b518fb5",
        "206": "5a0ee4b586f7743698200d22",
        "207": "5a0ec70e86f7742c0b518fba",
        "209": "5a0ee62286f774369454a7ac",
        "213": "5a0ee72c86f77436955d3435",
        "216": "5a0ee30786f774023b6ee08f",
        "218": "5a13eebd86f7746fd639aa93",
        "219": "5a13ef0686f7746e5a411744",
        "220": "5a0ee34586f774023b6ee092",
        "221": "5a0ee37f86f774023657a86f",
        "222": "5a13f24186f77410e57c5626",
        "226": "5a13f35286f77413ef1436b0",
        "301": "5a13ef7e86f7741290491063",
        "303": "5a0eeb1a86f774688b70aa5c",
        "306": "5a13f46386f7741dd7384b04",
        "308": "5a145d7b86f7744cbb6f4a13",
        "309": "5a0eeb8e86f77461257ed71a",
        "310": "5a0eec9686f77402ac5c39f2",
        "313": "5a0eecf686f7740350630097",
        "314": "5a0eed4386f77405112912aa",
        "316": "5a145ebb86f77458f1796f05",
        "322": "5a0eedb386f77403506300be",
        "323": "5a13ee1986f774794d4c14cd",
        "325": "5a0eebed86f77461230ddb3d",
        "328": "5a0eee1486f77402aa773226",
        "321 safe": "5a0eff2986f7741fd654e684",
        "utility room": "5a0ea79b86f7741d4a35298e",
        "warehouse safe": "5a0f0f5886f7741c4e32a472",
        "blue tape": "5eff09cd30a7dc22fd1ddfed",
        "office safe": "5a0f08bc86f77478f33b84c2",
        "Shoreline plan map": "5a8036fb86f77407252ddc02"
    },
};

module.exports = async () => {
    for(const map in keys){
        let mapPriceData = ['price,timestamp,name'];

        console.time(`longtime-price-query-${map}`);
        let historicalPriceData = await doQuery(`SELECT
            item_id, price, timestamp
        FROM
            price_data
        WHERE
            timestamp > 2021-12-12
        AND
            item_id
        IN (?)`, [Object.values(keys[map])]);
        console.timeEnd(`longtime-price-query-${map}`);

        for (const row of historicalPriceData) {
            let keyName = false;
            for(const name in keys[map]){
                if(keys[map][name] !== row.item_id){
                    continue;
                }

                keyName = name;
                break;
            }

            mapPriceData.push(`${row.price},${row.timestamp.toISOString()},${keyName}`);
        }

        historicalPriceData = null;

        fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', `historical-prices-${map}.csv`), mapPriceData.join('\n'));

        mapPriceData = null;
    }
};