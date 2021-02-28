require('dotenv').config();

const workerData = require('../modules/worker-data.js');
const remoteData = require('../modules/remote-data.js');

(async () => {
    const itemData = await remoteData.get();
    console.log('Updating all worker items');
    const retryList = [];
    let index = 0;
    for(const [key, item] of itemData){
        // console.log(item.id);
        index = index + 1;
        console.log(`${index}/${itemData.size}`)
        try {
            await workerData(item.id, item);
        } catch (workerUpdateError){
            retryList.push(item);
            console.error(workerUpdateError);
            console.log(item);
        }
    }

    console.log('Done updating all worker items');
    console.log('Retrying failed items');

    for(const item of retryList){
        try {
            await workerData(item.id, item);
        } catch (workerUpdateError){
            console.error(workerUpdateError);
        }
    }

    console.log('Done with all retries');
})();