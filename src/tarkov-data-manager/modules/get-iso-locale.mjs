const localeMap = {
    ch: 'zh',
    cz: 'cs',
    ge: 'de',
    jp: 'ja',
    kr: 'ko',
    po: 'pt',
    tu: 'tr',
    vi: 'vn',
    in: 'id',
};

const getIsoLocale = (eftLocale) => {
    return localeMap[eftLocale] ?? eftLocale;
};

export default getIsoLocale;
