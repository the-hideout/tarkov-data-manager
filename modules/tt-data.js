const got = require('got');

module.exports = async () => {
    const response = await got.post('https://tarkov-tools.com/graphql', {
        body: JSON.stringify({query: `{
            itemsByType(type: any){
              id
              name
              shortName
            }
          }`
        }),
        responseType: 'json',
    });

    return response.body.data.itemsByType.map(item => item.id);
};