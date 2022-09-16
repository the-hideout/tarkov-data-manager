let locales;

const getTranslation = (locales, code, translateFunction, logger) => {
    let lang = locales[code];
    if (!lang) lang = locales.en;
    try {
        return translateFunction(lang);
    } catch (error) {
        if (error.message.includes('Cannot read properties of undefined') && code !== 'en') {
            const attPattern = /\(reading '(.+)'\)/;
            const attMatch = error.message.match(attPattern)[1];
            if (logger) {
                logger.error(`Could not find attribute ${attMatch} for translation ${code}; defaulting to en`);
            } else {
                console.log(`Could not find attribute ${attMatch} for translation ${code}; defaulting to en`);
            }
            return translateFunction(locales.en);
        } else {
            throw error;
        }
    }
};

const translatePath = (langCode, path, logger, errorOnNotFound = true) => {
    if (!locales) throw new Error('You must call setLocales before translatePath');
    if (typeof path === 'string') path = [path];
    let translation = locales[langCode];
    if (!translation) {
        if (langCode !== 'en') {
            //if (logger) logger.warn(`Language "${langCode}" not found; defaulting to en`);
            //return module.exports.translatePath('en', path, logger, errorOnNotFound);
            return undefined;
        }
        throw new Error(`English translation localization missing`);
    }
    for (const pathPart of path) {
        translation = translation[pathPart];
        if (!translation) {
            if (langCode !== 'en') {
                //if (logger) logger.warn(`Translation for ${langCode}.${path.join('.')} not found; defaulting to en`);
                //return module.exports.translatePath('en', path, logger, errorOnNotFound);
                return undefined;
            }
            if (errorOnNotFound)
                throw new Error(`Translation for ${langCode}.${path.join('.')} not found`);
            logger.warn(`Translation for ${langCode}.${path.join('.')} not found`);
            return '';
        }
    }
    if (langCode !== 'en') {
        const enTran = translatePath('en', path, logger, errorOnNotFound);
        if (translation === enTran) return undefined;
    }
    return translation;
};

const getTranslations = (translationTarget, logger, errorOnNotFound = true) => {
    const translation = {};
    for (const langCode in locales) {
        translation[langCode] = {};
        for (const fieldName in translationTarget) {
            translation[langCode][fieldName] = translatePath(langCode, translationTarget[fieldName], logger, errorOnNotFound);
            if (typeof translation[langCode][fieldName] === 'undefined') {
                delete translation[langCode][fieldName];
            }
        }
    }
    for (const langCode in translation) {
        if (langCode === 'en')
            continue;
        for (const field in translation[langCode]) {
            if (translation[langCode][field] === translation.en[field]) {
                delete translation[langCode][field];
            }
        }
    }
    for (const langCode in translation) {
        if (Object.keys(translation[langCode]).length < 1) {
            delete translation[langCode];
        }
    }
    return translation;
};

module.exports = {
    setLocales: loc => {
        locales = loc;
    },
    translatePath: translatePath,
    getTranslation: getTranslation,
    getTranslations: getTranslations
};
