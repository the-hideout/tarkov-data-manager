const getTranslation = (locales, code, translateFunction, logger) => {
    let lang = locales[code];
    if (!lang) lang = locales.en;
    try {
        translateFunction(lang);
    } catch (error) {
        if (error.message.includes('Cannot read properties of undefined') && code !== 'en') {
            const attPattern = /\(reading '(.+)'\)/;
            const attMatch = error.message.match(attPattern)[1];
            if (logger) {
                logger.error(`Could not find attribute ${attMatch} for translation ${code}; defaulting to en`);
            } else {
                console.log(`Could not find attribute ${attMatch} for translation ${code}; defaulting to en`);
            }
            translateFunction(locales.en);
        } else {
            throw error;
        }
    }
};

module.exports = getTranslation;