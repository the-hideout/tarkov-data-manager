const got = require('got');

const apiUrl = 'https://api.tarkov.dev/graphql';
//const apiUrl = 'https://dev-api.tarkov.dev/graphql';
//const apiUrl = 'http://localhost:8787/graphql';

const query = async (graphql) => {
    return got(apiUrl, {
        method: 'post',
        json: {
            query: `{
                ${graphql}
            }`
        },
        responseType: 'json',
        resolveBodyOnly: true
    });
};

const tasks = async () => {
    const response = await query(`
        tasks {
          id
          tarkovDataId
          name
          startRewards {
            offerUnlock {
              trader {
                id
                name
              }
              level
              item {
                id
                name
                types
                properties {
                  ...on ItemPropertiesPreset {
                    baseItem {
                      id
                    }
                  }
                }
                containsItems {
                  item {
                    id
                    name
                  }
                }
              }
            }
          }
          finishRewards {
            offerUnlock {
              trader {
                id
                name
              }
              level
              item {
                id
                name
                types
                properties {
                  ...on ItemPropertiesPreset {
                    baseItem {
                      id
                    }
                  }
                }
                containsItems {
                  item {
                    id
                    name
                  }
                }
              }
            }
          }
        }
    `);
    return response.data.tasks;
};

module.exports = {
    query: query,
    tasks: tasks
};
