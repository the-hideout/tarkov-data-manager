const loadData = require('./load-data');

const getType = (itemId, bsgData, prevType) => {
      if(!bsgData[itemId]._parent){
          return prevType;
      }

      return getType(bsgData[itemId]._parent, bsgData, bsgData[itemId]._name)
};

module.exports = async () => {
    let bsgData = await loadData('all-bsg', 'https://tarkov-market.com/api/v1/bsg/items/all');
    let tmData = await loadData('all-tm', 'https://tarkov-market.com/api/v1/items/all?lang=en');

    const completeData = tmData.map((item) => {
        const bsgType = getType(item.bsgId, bsgData)
        return {
            ...item,
            ...bsgData[item.bsgId],
            bsgType: bsgType,
        };
    });

    return completeData;
};
