const { execSync } = require("child_process");

console.log('Updating quest data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "QUEST_DATA" > ../tarkov-data-manager/public/data/quest-data.json', {
    cwd: '../tarkov-data-api',
});

console.log('Updating trader data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "TRADER_ITEMS" > ../tarkov-data-manager/public/data/trader-items.json', {
    cwd: '../tarkov-data-api',
});

console.log('Updating item data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "ITEM_CACHE" > ../tarkov-data-manager/public/data/item-data.json', {
    cwd: '../tarkov-data-api',
});

console.log('Updating barter data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "BARTER_DATA" > ../tarkov-data-manager/public/data/barter-data.json', {
    cwd: '../tarkov-data-api',
});

console.log('Updating craft data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "CRAFT_DATA" > ../tarkov-data-manager/public/data/craft-data.json', {
    cwd: '../tarkov-data-api',
});

console.log('Updating hideout data');
execSync('wrangler kv:key get --namespace-id f04e5b75ee894b3a90cec2b7cc351311 "HIDEOUT_DATA" > ../tarkov-data-manager/public/data/hideout-data.json', {
    cwd: '../tarkov-data-api',
});