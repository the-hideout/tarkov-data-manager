let locales;

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

module.exports = {
    setLocales: loc => {
        locales = loc;
    },
    translatePath(langCode, path, logger) {
        if (!locales) throw new Error('You must call setLocales before translatePath');
        if (typeof path === 'string') path = [path];
        let translation = locales[langCode];
        if (!translation) {
            if (langCode !== 'en') {
                if (logger) logger.warn(`Language "${langCode}" not found; defaulting to en`);
                return module.exports.translatePath('en', path, logger);
            }
            throw new Error(`English translation localization missing`);
        }
        for (const pathPart of path) {
            translation = translation[pathPart];
            if (!translation) {
                if (langCode !== 'en') {
                    if (logger) logger.warn(`Translation for ${langCode}.${path.join('.')} not found; defaulting to en`);
                    return module.exports.translatePath('en', path, logger);
                }
                throw new Error(`Translation for ${langCode}."${path.join('.')}" not found`);
            }
        }
        return translation;
    },
    getTranslation: getTranslation
};
