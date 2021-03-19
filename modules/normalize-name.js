const unidecode = require('unidecode');

module.exports = (name) => {
    let decoded = unidecode(name);

    return decoded.toLowerCase() // lowercae
        .trim()
        .replace(/\s/g, '-') // replace spaces with dash
        .replace(/[^a-z0-9\-]/g, '') // remove any unwanted chars
        .replace(/\-\-/g, '-'); // make sure we only have a single -
};