class TranslationHelper {
    constructor(options) {
        if (!options) {
            options = {};
        }
        this.locales = options.locales ?? {};
        this.locale = options.target ?? {};
        this.logger = options.logger ?? {
            log: console.log,
            warn: console.warn,
            error: console.error,
        };
        this.warnOnKeySubstitution = !!options.warnOnKeySubstitution;
        this.translationKeys = new Set();
        this.translationKeyMap = {};
    }

    addTranslation = (key, langCode, value) => {
        if (!this.locale) {
            this.locale = {};
        }
        if (typeof langCode === 'function') {
            if (typeof key === 'string') {
                for (const langC in this.locales) {    
                    if (!this.locale[langC]) {
                        this.locale[langC] = {};
                    }
                    this.locale[langC][key] = langCode(this.locales[langC], langC);
                }
            } else if (Array.isArray(key)) {
                for (const k of key) {    
                    for (const langC in this.locales) {   
                        if (!this.locale[langC]) {
                            this.locale[langC] = {};
                        }
                        this.locale[langC][k] = langCode(k, this.locales[langC], langC);
                    }
                }
            } else {
                this.logger.warn(`${typeof key} is not a valid translation key`);
            }
            return key;
        }
        if (Array.isArray(key)) {
            for (const k of key) {
                if (!this.locale[k]){
                    this.locale[k] = {};
                }
                if (langCode && value) {
                    if (!this.locale[langCode]) {
                        this.locale[langCode] = {};
                    }
                    this.locale[langCode][key] = value;
                } else {
                    this.translationKeys.add(k);
                }
            }
            return key;
        }
        if (langCode) {
            if (typeof value !== 'undefined') {
                if (!this.locale[langCode]) {
                    this.locale[langCode] = {};
                }
                this.locale[langCode][key] = value;
            } else {
                throw new Error(`Cannot assign undefined value to ${langCode} ${key}`);
            }
        } else {
            if (typeof this.locales.en[key] !== 'undefined') {
                this.translationKeys.add(key);
            } else if (!this.translationKeyMap[key]) {
                if (typeof this.locales.en[key] === 'undefined') {
                    for (const dictKey in this.locales.en) {
                        if (dictKey.toLowerCase() === key.toLowerCase()) {
                            this.translationKeyMap[key] = dictKey;
                            if (this.warnOnKeySubstitution) {
                                this.logger.warn(`Translation key substition for ${key}: ${dictKey}`);
                            }
                            //return dictKey;
                            break;
                        }
                    }
                }
                if (!this.translationKeyMap[key]) {
                    this.logger.warn(`Translation key not found: ${key}`);
                }
                this.translationKeys.add(key);
            }
        }
        return key;
    }

    mergeTranslations = (newTranslations, target) => {
        if (!target) {
            target = this.locale;
        }
        for (const langCode in newTranslations) {
            if (!target[langCode]) {
                target[langCode] = {};
            }
            for (const key in newTranslations[langCode]) {
                if (target[langCode][key]) {
                    continue;
                }
                target[langCode][key] = newTranslations[langCode][key];
            }
        }
    }

    removeTranslation = (key, target) => {
        if (!target) {
            target = this.locale;
        }
        for (const langCode in target) {
            target[langCode][key] = undefined;
        }
    }

    getTranslation = (key, langCode = 'en', target) => {
        if (!target) {
            target = this.locale;
        }
        if (!target[langCode]) {
            target[langCode] = {};
        }
        if (typeof target[langCode][key] !== 'undefined') {
            return target[langCode][key];
        }
        const usedKey = this.translationKeyMap[key] ? this.translationKeyMap[key] : key;
        if (typeof usedKey === 'function') {
            target[langCode][key] = usedKey(key, langCode, this.locales[langCode]);
            return target[langCode][key];
        }
        target[langCode][key] = this.locales[langCode][usedKey];
        if (typeof target[langCode][key] === 'undefined' && langCode === 'en') {
            target[langCode][key] = usedKey;
            //return Promise.reject(new Error(`Missing translation for ${key}`));
        }
        return target[langCode][key];
    }

    fillTranslations = async (target) => {
        if (!target) {
            target = this.locale;
        }
        for (const langCode in this.locales) {
            if (!target[langCode]) {
                target[langCode] = {};
            }
            for (const key of this.translationKeys) {
                this.getTranslation(key, langCode, target);
            }
        }
        for (const langCode in target) {
            if (langCode === 'en') {
                continue;
            }
            for (const key in target[langCode]) {
                if (target.en[key] === target[langCode][key] || (!!target.en[key] && !target[langCode][key])) {
                    delete target[langCode][key];
                }
            }
            if (Object.keys(target[langCode]).length < 1) {
                delete target[langCode];
            }
        }
        return target;
    }

    getMobKey = (enemy) => {
        const keySubs = {
            arenaFighterEvent: 'ArenaFighterEvent',
            followerTagilla: 'bossTagilla',
            AnyPmc: 'AnyPMC',
            exUsec: 'ExUsec',
            marksman: 'Marksman',
            pmcBot: 'PmcBot',
            savage: 'Savage',
            assaultTutorial: 'Savage',
            sentry: 'Sentry',
        };
        return keySubs[enemy] || enemy;
    }

    addMobTranslation = (key) => {
        if (typeof this.locales.en[key] !== 'undefined') {
            this.translationKeys.add(key);
        } else if (typeof this.translationKeyMap[key] === 'undefined') {
            let foundKey = this.getMobKey(key);
            let found = false;
            if (enemyKeyMap[key]) {
                foundKey = enemyKeyMap[key];
            }
            if (this.locales.en[foundKey]) {
                this.translationKeyMap[key] = foundKey;
                found = true;
            }
            const enemyKeys = [
                `QuestCondition/Elimination/Kill/BotRole/${foundKey}`,
                `QuestCondition/Elimination/Kill/Target/${foundKey}`,
                `ScavRole/${foundKey}`,
                `SCAVROLE/${foundKey}`,
            ];
            for (const enemyKey of enemyKeys) {
                if (found) {
                    break;
                }
                if (this.locales.en[enemyKey]) {
                    this.translationKeyMap[key] = enemyKey;
                    found = true;
                    break;
                }
            }
            
            if (key.includes('follower') && !key.includes('BigPipe') && !key.includes('BirdEye')) {
                this.translationKeyMap[key] = (key, langCode, lang) => {    
                    const nameParts = [];
                    const guardTypePattern = /Assault|Security|Scout|Snipe|Close1|Close2/;
                    const bossKey = key.replace('follower', 'boss').replace(guardTypePattern, '');
                    this.addMobTranslation(bossKey);
                    this.addMobTranslation('Follower');
                    nameParts.push(this.getTranslation(bossKey, langCode));
                    nameParts.push(this.getTranslation('Follower', langCode));
                    const guardTypeMatch = key.match(guardTypePattern);
                    if (guardTypeMatch) {
                        if (lang[`follower${guardTypeMatch[0]}`]) {
                            nameParts.push(`(${lang[`follower${guardTypeMatch[0]}`]})`);
                        } else {
                            nameParts.push(`(${guardTypeMatch[0]})`);
                        }
                    }
                    return nameParts.join(' ');
                };
            }
            if (key === 'peacefullZryachiyEvent') {
                this.addMobTranslation('bossZryachiy');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('bossZryachiy', langCode)} (${lang.Peaceful || 'Peaceful'})`;
                };
            }
            if (key === 'ravangeZryachiyEvent') {
                this.addMobTranslation('bossZryachiy');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('bossZryachiy', langCode)} (${lang['6530e8587cbfc1e309011e37 ShortName'] || 'Vengeful'})`;
                };
                
            }
            if (key === 'sectactPriestEvent') {
                this.addMobTranslation('sectantPriest');
                this.translationKeyMap[key] = (key, langCode, lang) => {
                    return `${this.getTranslation('sectantPriest', langCode)} (${lang.Ritual})`;
                };
            }
            for (const enemyKey of enemyKeys) {
                if (found) {
                    break;
                }
                for (const key in this.locales.en) {
                    if (key.toLowerCase() === enemyKey.toLowerCase()) {
                        this.translationKeyMap[key] = enemyKey;
                        found = true;
                        break;
                    }
                }
            }

            if (!this.translationKeyMap[key]) {
                this.logger.warn(`Translation key not found: ${key}`);
            }
            this.translationKeys.add(key);
        }
        return key;
    }

    hasTranslation = (key, langCode = 'en') => {
        let deepSearch = false;
        if (typeof langCode === 'boolean') {
            deepSearch = langCode;
            langCode = 'en';
        }
        if (typeof this.locales[langCode][key] !== 'undefined') {
            return true;
        }
        if (!deepSearch) {
            return false;
        }
        for (const k in this.locales.en) {
            if (k.toLowerCase() === key.toLowerCase()) {
                return true;
            }
        }
        return false;
    }
}

const enemyKeyMap = {
    //'assault': 'ArenaFighterEvent',
    'scavs': 'Savage',
    'sniper': 'Marksman',
    'sectantWarrior': 'cursedAssault',
    'bossZryachiy': '63626d904aa74b8fe30ab426 ShortName',
    'pmcBEAR': 'BEAR',
    'pmcUSEC': 'USEC',
    'civilian': 'CIVILIAN',
    'blackDivision': 'BlackDivision',
    'sniperBlackDivision': 'SniperBlackDivision',
    'vsRF': 'VSRF',
    'vsRFSniper': 'VSRF',
};

export default TranslationHelper;
