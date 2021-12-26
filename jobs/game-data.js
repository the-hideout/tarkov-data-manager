const bsgData = require('./update-bsg-data');
const updateGameData = require('./update-game-data');
const updateTranslations = require('./update-translations');

module.exports = async () => {
    try {
        await bsgData();
    } catch (loadingBsgDataError){
        console.error(loadingBsgDataError);

        return false;
    }

    try {
        await updateGameData();
    } catch (gameDataUpdateError){
        console.error(gameDataUpdateError);

        return false;
    }

    try {
        await updateTranslations();
    } catch (translationsUpdateError){
        console.error(translationsUpdateError);
    }
}