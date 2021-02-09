const got = require('got');

module.exports = async (itemId, itemData) => {
    console.log(`Updating ${itemId}`);
    return got.post(`https://tarkov-tools.com/ingest`, {
        json: {
            itemId: itemId,
            ...itemData,
        },
    });
};
