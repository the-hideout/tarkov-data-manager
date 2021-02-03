const fs = require('fs');
const path = require('path');

const isHorizontal = require('../modules/is-horizontal');
const getData = require('../modules/get-data');

const data = require('../data.json');

(async () => {
    const allData = await getData();

    for(const item of allData){
        if(data[item._id]?.horizontal){
            continue;
        }
        console.log(`Checking ${item.name}`);

        if(!data[item._id]){
            data[item._id] = {
                name: item.name,
                id: item._id,
                types: [],
            };
        }

        const itemImageIsHorizontal = await isHorizontal(item.img);

        if(itemImageIsHorizontal){
            data[item._id].horizontal = true;
        }

        fs.writeFileSync(path.join(__dirname, '..', 'data.json'), JSON.stringify(data, null, 4));
    }
})();
