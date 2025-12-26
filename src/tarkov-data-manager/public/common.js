const AVAILABLE_TYPES = [
    'ammo-box',
    'ammo',
    'armor',
    'armor-plate',
    'backpack',
    'barter',
    'container',
    'disabled',
    'glasses',
    'grenade',
    'gun',
    'headphones',
    'helmet',
    'injectors',
    'keys',
    'marked-only',
    'meds',
    'mods',
    'no-flea',
    'only-flea',
    'pistol-grip',
    'poster',
    'preset',
    'provisions',
    'quest',
    'rig',
    'suppressor',
    'wearable',
    'special-slot',
];

const CUSTOM_HANDLERS = [
    'all',
    'missing-image',
    'no-wiki'
];

const formatPrice = (price) => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumSignificantDigits: 6,
    }).format(price);
};

async function postData(url = '', data = {}) {
    // Default options are marked with *
    const response = await fetch(url, {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *cors, same-origin
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      credentials: 'same-origin', // include, *same-origin, omit
      headers: {
        'Content-Type': 'application/json'
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'follow', // manual, *follow, error
      referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify(data) // body data type must match "Content-Type" header
    });

    return response.json(); // parses JSON response into native JavaScript objects
}