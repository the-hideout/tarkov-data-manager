const got = require('got');

module.exports = async () => {
    const response = await got.post('https://tarkov-tools.com/graphql', {
        body: JSON.stringify({query: `{
            itemsByType(type: any){
              id
              name
              shortName
              types
              normalizedName
              traderPrices {
                  trader {
                      name
                  }
                  price
              }
            }
          }`
        }),
        responseType: 'json',
    });

    return Object.fromEntries(response.body.data.itemsByType.map(item => {
        return [item.id, {
            id: item.id,
            name: item.name,
            shortName: item.shortName,
            types: item.types,
            traderPrices: item.traderPrices,
            normalizedName: item.normalizedName,
        }];
    }));
};