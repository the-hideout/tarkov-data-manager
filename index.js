const fs = require('fs');
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const Jimp = require('jimp');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const basicAuth = require('express-basic-auth');
const formidable = require('formidable');
const Rollbar = require('rollbar');

const remoteData = require('./modules/remote-data');
const getLatestScanResults = require('./modules/get-latest-scan-results');
const jobs = require('./jobs');
const connection = require('./modules/db-connection');
const timer = require('./modules/timer');

const rollbar = new Rollbar({
    accessToken: process.env.ROLLBAR_TOKEN,
    captureUncaught: true,
    captureUnhandledRejections: true
});

const app = express();
const port = process.env.PORT || 4000;

let myData = false;

const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: fromEnv(),
});

function maybe(fn) {
    return function(req, res, next) {
        if (req.path === '/suggest-image' && req.method === 'POST') {
            next();
        } else {
            fn(req, res, next);
        }
    }
};

const users = {
    'kokarn': process.env.AUTH_PASSWORD,
};

if(process.env.SECOND_AUTH_PASSWORD){
    users.razzmatazz = process.env.SECOND_AUTH_PASSWORD;
};

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(maybe(basicAuth({
    challenge: true,
    realm: 'tarkov-data-manager',
    users: users,
})));

const encodeToast = (text) => {
    return Buffer.from(text, 'utf8').toString('hex');
};

const decodeToast = (hex) => {
    return Buffer.from(hex, 'hex').toString('utf8');
}

const urlencodedParser = bodyParser.urlencoded({ extended: false })

try {
    fs.mkdirSync(path.join(__dirname, 'cache'));
} catch (createError){
    if(createError.code !== 'EEXIST'){
        console.error(createError);
    }
}

try {
    fs.mkdirSync(path.join(__dirname, 'dumps'));
} catch (createError){
    if(createError.code !== 'EEXIST'){
        console.error(createError);
    }
}

const AVAILABLE_TYPES = [
    'glasses',
    'helmet',
    'barter',
    'provisions',
    'wearable',
    'mods',
    'keys',
    'un-lootable',
    'marked-only',
    'ammo',
    'armor',
    'no-flea',
    'backpack',
    'grenade',
    'gun',
    'headphones',
    'rig',
    'suppressor',
];

const CUSTOM_HANDLERS = [
    'untagged',
    'no-icon',
    'no-image',
    'missing-image',
    'no-wiki',
    'all',
];

const formatPrice = (price) => {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumSignificantDigits: 6,
    }).format(price);
};

const updateTypes = async (updateObject) => {
    const updateData = await remoteData.get();
    const currentItemData = updateData.get(updateObject.id);

    if(updateObject.active === false && !currentItemData.types.includes(updateObject.type)){
        return true;
    }

    if(updateObject.active === false){
        currentItemData.types.splice(currentItemData.types.indexOf(updateObject.type), 1);
        remoteData.removeType(updateObject.id, updateObject.type);
    }

    if(updateObject.active === true){
        currentItemData.types.push(updateObject.type);
        remoteData.addType(updateObject.id, updateObject.type);
    }

    updateData.set(updateObject.id, currentItemData);

    remoteData.update();
    myData = updateData;
};

const getItemTypesMarkup = (item) => {
    let markupString = '<td class="types-column">';
    for(const type of AVAILABLE_TYPES){
        markupString = `${markupString}
        <div class="type-wrapper">
            <label for="${item.id}-${type}">
                <input type="checkbox" id="${item.id}-${type}" value="${type}" data-item-id="${item.id}" ${myData.get(item.id).types?.includes(type) ? 'checked' : ''} />
                <span>${type}</span>
            </label>
        </div>`;
    }

    markupString = `${markupString}</td>`;

    return markupString;
};

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const getTableContents = async (filterObject) => {
    let tableContentsString = '';
    let maxItems = 3000;
    let items = 0;

    for(const [key, item] of myData){
        if(filterObject?.type){
            switch (filterObject.type){
                case 'all':
                    // Allow all items
                    break;
                case 'untagged':
                    if(item.types.length > 0){
                        continue;
                    }
                    break;
                case 'no-image':
                    if(item.image_link){
                        continue;
                    }

                    break;
                case 'no-icon':
                    if(item.icon_link){
                        continue;
                    }

                    break;
                case 'missing-image':
                    if(item.image_link && item.icon_link && item.grid_image_link){
                        continue;
                    }

                    break;
    
                case 'no-wiki':
                    if(item.wiki_link){
                        continue;
                    }

                    break;
                default:
                    if(!item.types.includes(filterObject.type)){
                        continue;
                    }
            }
        }

        items = items + 1;

        const scanImageUrl = `https://tarkov-data.s3.eu-north-1.amazonaws.com/${item.id}/latest.jpg`;
        tableContentsString = `${tableContentsString}
        <tr>
            <td class="name-column">
                <a href="${item.wiki_link}" >${item.name}</a>
                ${item.id}
                <div>
                    <a href="/items/${filterObject.type}/edit/${item.id}">Edit</a>
                </div>
            </td>
            <td>
                ${item.image_link ? `<img src="${item.image_link}" loading="lazy" />`: ''}
            </td>
            <td>
                ${item.icon_link ? `<img src="${item.icon_link}" loading="lazy" />`: ''}
            </td>
            <td>
                ${item.grid_image_link ? `<img src="${item.grid_image_link}" loading="lazy" />`: ''}
            </td>
            ${getItemTypesMarkup(item)}
            <td>
                ${formatPrice(item.avg24hPrice)}
            </td>
            <td>
                <a href="${scanImageUrl}">
                    <img src="https://images.weserv.nl/?url=${encodeURIComponent(scanImageUrl)}&w=128&h=72" class="scan-image" loading="lazy">
                </a>
            </td>
            </tr>`;

            // <td>
            //     <pre>${JSON.stringify(item, null, 4)}</pre>
            // </td>
        if(items > maxItems){
            break;
        }
    }

    return tableContentsString;
};

const getHeader = (req) => {
    let javascript = '';
    if (req.query.toast) {
        javascript = `
            <script>
                $(document).ready(function() {
                    M.toast({html: '${decodeToast(req.query.toast)}'});
                });
            </script>
        `;
    }
    return `
    <!DOCTYPE html>
        <head>
            <title>Tarkov Data Studio</title>

            <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
            <link rel="stylesheet" href="https://cdn.datatables.net/1.10.23/css/jquery.dataTables.min.css">
            <script src="https://cdn.datatables.net/1.10.23/js/jquery.dataTables.min.js"></script>

            <!-- Compiled and minified CSS -->
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">

            <!-- Compiled and minified JavaScript -->
            <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
            <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
            <link rel="manifest" href="/site.webmanifest">
            <meta name="msapplication-TileColor" content="#da532c">
            <meta name="theme-color" content="#ffffff">
            <link rel="stylesheet" href="/index.css" />
            ${javascript}
        </head>
        <body>
            <script src="/ansi_up.js"></script>
            <script src="/index.js"></script>
            <nav>
                <div class="nav-wrapper">
                    <ul id="nav-mobile" class="left hide-on-med-and-down">
                        <li><a href="/">Home</a></li>
                        ${
                            AVAILABLE_TYPES
                                .concat(CUSTOM_HANDLERS)
                                .sort()
                                .map(type => `<li><a href="/items/${type}">${capitalizeFirstLetter(type)}</a></li>`)
                                .join(' ')
                        }
                    </ul>
                </div>
            </nav>
        `;
}

app.get('/data', async (req, res) => {
    const allData = await remoteData.get();

    res.send(allData);
});

app.post('/update', (request, response) => {
    console.log(request.body);
    updateTypes(request.body);

    response.send('ok');
});

app.post('/suggest-image', (request, response) => {
    const form = formidable({
        multiples: true,
        uploadDir: path.join(__dirname, 'cache'),
    });

    console.log('got request');

    form.parse(request, async (err, fields, files) => {
        if (err) {
            console.log(err);

            next(err);

            return false;
        }

        console.log(fields);
        // console.log(files);

        const allItemData = await remoteData.get();
        const currentItemData = allItemData.get(fields.id);

        if(fields.type !== 'grid-image' && fields.type !== 'icon' && fields.type !== 'image'){
            return response
                .status(400)
                .send({
                    error: 'Unknown type',
            });
        }

        if(fields.type === 'grid-image' && currentItemData.grid_image_link){
            return response
                .status(400)
                .send({
                    error: 'That item ID already has a grid-image',
                });
        }

        if(fields.type === 'icon' && currentItemData.icon_link){
            return response
                .status(400)
                .send({
                    error: 'That item ID already has a icon',
                });
        }

        if(fields.type === 'image' && currentItemData.image_link){
            return response
                .status(400)
                .send({
                    error: 'That item ID already has a icon',
                });
        }

        let image = false;
        try {
            image = await Jimp.read(files[fields.type].path);
        } catch (someError){
            console.error(someError);

            return response.send(someError);
        }

        if(!image){
            return response
                .status(503)
                .send('Failed to add image');
        }

        const uploadParams = {
            Bucket: 'assets.tarkov-tools.com',
            Key: `${fields.id}-${fields.type}.jpg`,
            ContentType: 'image/jpeg',
            CacheControl: 'max-age=604800',
        };

        uploadParams.Body = await image.getBufferAsync(Jimp.MIME_JPEG);

        try {
            await s3.send(new PutObjectCommand(uploadParams));
            console.log("Image saved to s3");
        } catch (err) {
            console.log("Error", err);

            return response.send(err);
        }

        try {
            await remoteData.setProperty(fields.id, `${fields.type.replace(/\-/g, '_')}_link`, `https://assets.tarkov-tools.com/${fields.id}-${fields.type}.jpg`);
        } catch (updateError){
            console.error(updateError);
            return response.send(updateError);
        }

        console.log(`${fields.id} ${fields.type} updated`);

        response.send('ok');
    });
});

app.post('/items/:type/edit/:id', urlencodedParser, async (req, res) => {
    console.log(req.body);
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);
    let updated = false;
    let message = 'No changes made.';

    if(req.body['icon-link'] && req.body['icon-link'] !== 'null' && currentItemData.icon_link !== req.body['icon-link']){
        console.log('Updating icon link');
        let image = false;
        try {
            image = await Jimp.read(req.body['icon-link']);
        } catch (someError){
            console.error(someError);
        }

        if(!image){
            return res.send('Failed to add image');
        }

        const uploadParams = {
            Bucket: 'assets.tarkov-tools.com',
            Key: `${req.params.id}-icon.jpg`,
            ContentType: 'image/jpeg',
        };

        uploadParams.Body = await image.getBufferAsync(Jimp.MIME_JPEG);

        try {
            await s3.send(new PutObjectCommand(uploadParams));
            console.log("Image saved to s3");
        } catch (err) {
            console.log("Error", err);

            return res.send(err);
        }

        await remoteData.setProperty(req.params.id, 'icon_link', `https://assets.tarkov-tools.com/${req.params.id}-icon.jpg`);
        updated = true;
    }

    if(req.body['image-link'] && req.body['image-link'] !== 'null' && currentItemData.image_link !== req.body['image-link']){
        console.log('Updating image link');
        let image = await Jimp.read(req.body['image-link']);

        if(!image){
            return res.send('Failed to add image');
        }

        const uploadParams = {
            Bucket: 'assets.tarkov-tools.com',
            Key: `${req.params.id}-image.jpg`,
            ContentType: 'image/jpeg',
        };

        uploadParams.Body = await image.getBufferAsync(Jimp.MIME_JPEG);

        try {
            await s3.send(new PutObjectCommand(uploadParams));
            console.log("Image saved to s3");
        } catch (err) {
            console.log("Error", err);

            return res.send(err);
        }

        await remoteData.setProperty(req.params.id, 'image_link', `https://assets.tarkov-tools.com/${req.params.id}-image.jpg`);
        updated = true;
    }

    if(req.body['grid-image-link'] && req.body['grid-image-link'] !== 'null' && currentItemData.grid_image_link !== req.body['grid-image-link']){
        let image = await Jimp.read(req.body['grid-image-link']);

        if(!image){
            return res.send('Failed to add image');
        }

        const uploadParams = {
            Bucket: 'assets.tarkov-tools.com',
            Key: `${req.params.id}-grid-image.jpg`,
            ContentType: 'image/jpeg',
        };

        uploadParams.Body = await image.getBufferAsync(Jimp.MIME_JPEG);

        try {
            await s3.send(new PutObjectCommand(uploadParams));
            console.log("Image saved to s3");
        } catch (err) {
            console.log("Error", err);

            return res.send(err);
        }

        await remoteData.setProperty(req.params.id, 'grid_image_link', `https://assets.tarkov-tools.com/${req.params.id}-grid-image.jpg`);
        updated = true;
    }

    if(req.body['wiki-link'] && req.body['wiki-link'] !== 'null' && currentItemData.wiki_link !== req.body['wiki-link']){
        await remoteData.setProperty(req.params.id, 'wiki_link', req.body['wiki-link']);
        updated = true;
    }

    if (updated) {
        message = `${currentItemData.name} updated.<br>Will be live in < 4 hours.`;
    }
    return res.redirect(`/items/${req.params.type}?toast=${encodeToast(message)}`);
});

app.get('/items/:type/edit/:id', async (req, res) => {
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);

    // return res.send(currentItemData);

    // console.log(currentItemData);

    let updatedText = '';
    if (req.query.updated == 1) {
        updatedText = '<div class="row">Updated. Will be live in < 4 hours</div>';
    } else if (req.query.updated == 0) {
        updatedText = '<div class="row">No changes made.</div>'
    }

    return res.send(`${getHeader(req)}
        ${updatedText}
        <div class="row">
            <div class"col s6">
                ${currentItemData.name}
            </div>
            <div class"col s6">
                ${currentItemData.id}
            </div>
        </div>
        <div class="row">
            <form class="col s12" method="post" action="/items/${req.params.type}/edit/${currentItemData.id}">
            <div class="row">
                    <div class="input-field col s2">
                        ${currentItemData.image_link ? `<img src="${currentItemData.image_link}">`: ''}
                    </div>
                    <div class="input-field col s10">
                        <input value="${currentItemData.image_link}" id="image-link" type="text" class="validate" name="image-link">
                        <label for="image-link">Image Link</label>
                    </div>
                </div>
                <div class="row">
                    <div class="input-field col s2">
                        ${currentItemData.icon_link ? `<img src="${currentItemData.icon_link}">`: ''}
                    </div>
                    <div class="input-field col s10">
                        <input value="${currentItemData.icon_link}" id="icon-link" type="text" class="validate" name="icon-link">
                        <label for="icon-link">Icon Link</label>
                    </div>
                </div>
                <div class="row">
                    <div class="input-field col s2">
                        ${currentItemData.grid_image_link ? `<img src="${currentItemData.grid_image_link}">`: ''}
                    </div>
                    <div class="input-field col s10">
                        <input value="${currentItemData.grid_image_link}" id="grid-image-link" type="text" class="validate" name="grid-image-link">
                        <label for="grid-image-link">Grid image link</label>
                    </div>
                </div>
                <div class="row">
                <div class="input-field col s2">
                    ${currentItemData.wiki_link ? `<a href="${currentItemData.wiki_link}">WIKI</a>`: `<button class="btn guess-wiki-link" type="button" data-item-name="${currentItemData.name}">Guess</button>`}
                </div>
                <div class="input-field col s10">
                    <input value="${currentItemData.wiki_link}" id="wiki-link" type="text" class="validate" name="wiki-link">
                    <label for="wiki-link">wiki link</label>
                </div>
            </div>
                <div class="row">
                    <div class="input-field col s12">
                        <button class="btn waves-effect waves-light" type="submit" name="action">
                            Save
                        </button>
                    </div>
                </div>
            </form>
        </div>

    `);
});

app.get('/items/:type', async (req, res) => {
    const t = timer('getting-items');
    myData = await remoteData.get();
    t.end();
    res.send(`${getHeader(req)}
        <table class="highlight">
            <thead>
                <tr>
                    <th>
                        Name
                    </th>
                    <th>
                        Image
                    </th>
                    <th>
                        Icon
                    </th>
                    <th>
                        Grid image
                    </th>
                    <th>
                        Tags
                    </th>
                    <th>
                        Price
                    </th>
                    <th>
                        Scan image
                    </th>
                </tr>
            </thead>
            <tbody>
                ${ await getTableContents({
                    type: req.params.type,
                })}
            </tbody>
        </table>
    `);
});

app.get('/', async (req, res) => {
    const latestScanResults = await getLatestScanResults();
    const activeScanners = [];
    const inactiveScanners = [];
    latestScanResults.map(latestScan => {
        if (new Date - latestScan.timestamp > 1000 * 60 * 60 *24 * 7) {
            inactiveScanners.push(latestScan);
        } else {
            activeScanners.push(latestScan);
        }
    });
    const getScannerStuff = (scanner, active) => {
        let activeClass = '';
        if (active) {
            activeClass = ' active';
        }
        return `
        <div class="scanner">
            <ul class="collapsible" data-collapsible="collapsible">
                <li class="${activeClass}">
                    <div class="collapsible-header"><span class="tooltipped" data-tooltip="${scanner.timestamp}" data-position="right">${scanner.source}</span></div>
                    <div class="collapsible-body log-messages log-messages-${scanner.source}"></div>
                    <script>
                        startListener('${scanner.source}');
                    </script>
                </li>
            </ul>
        </div>
        `;
    };
    res.send(`${getHeader(req)}
        <div>Active Scanners</div>
        <div class="scanners-wrapper">
            ${activeScanners.map((latestScan) => {
                return getScannerStuff(latestScan, true);
            }).join('')}
        </div>
        <div>Inactive Scanners</div>
        <div class="scanners-wrapper"">
        ${inactiveScanners.map(latestScan => {
            return getScannerStuff(latestScan, false);
        }).join('')}
        </div>
    `);
});

const server = app.listen(port, () => {
    console.log(`Tarkov Data Manager listening at http://localhost:${port}`)
});

jobs();

(async () => {
    const triggerShutdown = () => {
        console.log('Closing HTTP server');
        server.close(() => {
            console.log('HTTP server closed');
        });
        connection.end();
    };
    //gracefully shutdown on Ctrl+C
    process.on( 'SIGINT', triggerShutdown);
    //gracefully shutdown on Ctrl+Break
    process.on( 'SIGBREAK', triggerShutdown);
    //try to gracefully shutdown on terminal closed
    process.on( 'SIGHUP', triggerShutdown);
})();