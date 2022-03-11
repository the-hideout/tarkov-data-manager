const bsgData = require('./update-bsg-data');
const updateGameData = require('./update-game-data');
const updateTranslations = require('./update-translations');
const updateTypes = require('./update-types');

module.exports = async () => {
    try {
        await bsgData();
    } catch (updateError){
        console.error(updateError);

        return false;
    }

    try {
        await updateGameData();
    } catch (updateError){
        console.error(updateError);

        return false;
    }

    try {
        await updateTranslations();
    } catch (updateError){
        console.error(updateError);
    }

    try {
        await updateTypes();
    } catch (updateError){
        console.error(updateError);
    }
}