const loadData = require('./load-data');

module.exports = async () => {
    return await loadData('all-bsg', 'https://tarkov-market.com/api/v1/bsg/items/all');
};