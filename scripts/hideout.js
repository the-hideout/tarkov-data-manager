const fs = require('fs');
const path = require('path');

const ttData = require('../modules/tt-data');

const hideoutData = require('../dumps/hideout.json');
const commandAruments = process.argv.slice(2);

const getNewId = () => {
    let max = 0;
    for(const module of hideoutData.modules){
        for(const requirement of module.require){
            if(requirement.id > max){
                max = requirement.id;
            }
        }
    }

    return max + 1;
};

const viewModule = (name, allTTData) => {
    for(const module of hideoutData.modules){
        if(!module.module.toLowerCase().includes(name.toLowerCase())){
            // console.log(module.module);
            continue;
        }

        console.log(`${module.module} ${module.level}`);

        const formattedRequirements = [];

        for(const requirement of module.require){
            if(requirement.type !== 'item'){
                continue;
            }

            formattedRequirements.push({
                ...requirement,
                readableName: allTTData[requirement.name].name,
            });
        }

        console.log(formattedRequirements);
    }
};

const addItem = (moduleName, moduleLevel, itemId, itemQuantity) => {
    for(const module of hideoutData.modules){
        if(module.module.toLowerCase() !== moduleName.toLowerCase()){
            continue;
        }

        if(module.level !== Number(moduleLevel)){
            continue;
        }

        console.log(`${module.module} ${module.level}`);

        module.require.push({
            type: 'item',
            name: itemId,
            quantity: Number(itemQuantity),
            id: getNewId(),
        });
    }
};

const removeItem = (moduleName, moduleLevel, itemId) => {
    for(const module of hideoutData.modules){
        if(module.module.toLowerCase() !== moduleName.toLowerCase()){
            continue;
        }

        if(module.level !== Number(moduleLevel)){
            continue;
        }

        console.log(`${module.module} ${module.level}`);

        module.require = module.require.filter(requirement => requirement.name !== itemId);
    }
};

const changeItem = (moduleName, moduleLevel, itemId, itemQuantity) => {
    for(const module of hideoutData.modules){
        if(module.module.toLowerCase() !== moduleName.toLowerCase()){
            continue;
        }

        if(module.level !== Number(moduleLevel)){
            continue;
        }

        console.log(`${module.module} ${module.level}`);

        for(const requirement of module.require){
            if(requirement.name !== itemId){
                continue;
            }

            requirement.quantity = Number(itemQuantity);
        }
    }
};

(async () => {
    const allTTData = await ttData();

    switch(commandAruments[0]){
        case 'view':
            viewModule(commandAruments[1], allTTData);

            break;
        case 'add':
            addItem(commandAruments[1], commandAruments[2], commandAruments[3], commandAruments[4]);

            break;
        case 'remove':
            removeItem(commandAruments[1], commandAruments[2], commandAruments[3], commandAruments[4]);

            break;
        case 'change':
            changeItem(commandAruments[1], commandAruments[2], commandAruments[3], commandAruments[4]);

            break;
        default:
            console.log(commandAruments);
    }

    fs.writeFileSync(path.join(__dirname, '..', 'dumps', 'hideout.json'), JSON.stringify(hideoutData, null, 4));
})()