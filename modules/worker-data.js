const got = require('got');

module.exports = async (id, itemData) => {
    // console.log(`Updating ${id}`);
    return got.post(`https://tarkov-tools.com/ingest`, {
        json: {
            id: id,
            ...itemData,
        },
    });
};
