let locales;

const getTranslation = (langCode, translationTarget, logger, errorOnNotFound = true) => {
    if (!locales) {
        return Promise.reject(new Error('Must call setLocales before getTranslation'));
    }
    if (Array.isArray(translationTarget)) {
        return translatePath(langCode, translationTarget, logger, errorOnNotFound);
    } else if (typeof translationTarget === 'function') {
        try {
            return translationTarget(locales[langCode], langCode);
        } catch (error) {
            if (langCode !== 'en') {
                return translationTarget(locales['en'], logger);
            } else if (errorOnNotFound) {
                throw error;
            }
        }
    } else {
        return Promise.reject(new Error(`Invalid translation target type (${typeof translationTarget}); expected array or function`));
    }
};

const translatePath = (langCode, path, logger, errorOnNotFound = true) => {
    if (!locales) {
        throw new Error('Must call setLocales before translatePath');
    }
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
    if (!locales) {
        return Promise.reject(new Error('Must call setLocales before getTranslations'));
    }
    const translation = {};
    for (const langCode in locales) {
        translation[langCode] = {};
        for (const fieldName in translationTarget) {
            if (Array.isArray(translationTarget[fieldName]) || typeof translationTarget[fieldName] === 'string') {
                translation[langCode][fieldName] = translatePath(langCode, translationTarget[fieldName], logger, errorOnNotFound);
            } else if (typeof translationTarget[fieldName] === 'function') {
                try {
                    translation[langCode][fieldName] = translationTarget[fieldName](locales[langCode], langCode);
                } catch (error) {
                    if (langCode !== 'en') {
                        translation[langCode][fieldName] = translationTarget[fieldName](locales['en'], logger);
                    } else if (errorOnNotFound) {
                        throw error;
                    }
                }
            } else {
                return Promise.reject(new Error(`Invalid translation target type (${typeof translationTarget[fieldName]}) for ${fieldName}; expected array or function`));
            }
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
            if (!Array.isArray(translation[langCode][field]) || !Array.isArray(translation.en[field])) {
                continue;
            }
            if (translation[langCode][field].length !== translation.en[field].length) {
                continue;
            }
            let mismatch = false;
            for (let i = 0; i < translation[langCode][field].length; i++) {
                if (translation[langCode][field][i] !== translation.en[field][i]) {
                    mismatch = true;
                    break;
                }
            }
            if (mismatch) {
                continue;
            }
            delete translation[langCode][field];
        }
    }
    for (const langCode in translation) {
        if (Object.keys(translation[langCode]).length < 1) {
            delete translation[langCode];
        }
    }
    return translation;
};

const mergeLocale = (destinationLocale, newLocale) => {
    if (!locales) {
        return Promise.reject(new Error('You must call setLocales before mergeLocale'));
    }
    if (typeof destinationLocale !== 'object') {
        return Promise.reject(new Error('Cannot add to destination locale this is not an object'));
    }
    for (const langCode in newLocale) {
        if (!destinationLocale[langCode]) {
            destinationLocale[langCode] = {};
        }
        destinationLocale[langCode] = {
            ...destinationLocale[langCode],
            ...newLocale[langCode]
        }
    }
    return destinationLocale;
};

const addTranslations = (destinationLocale, translationTarget, logger, errorOnNotFound) => {
    return mergeLocale(destinationLocale, getTranslations(translationTarget, logger, errorOnNotFound));
};

module.exports = {
    setLocales: loc => {
        locales = loc;
    },
    translatePath: translatePath,
    getTranslation: getTranslation,
    getTranslations: getTranslations,
    addTranslations: addTranslations,
    mergeLocale: mergeLocale,
};
