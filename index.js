const fs = require('fs');
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const Jimp = require('jimp');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');
const schedule = require('node-schedule');
const WebSocket = require('ws');
const basicAuth = require('express-basic-auth');

const remoteData = require('./modules/remote-data');
const getLatestScanResults = require('./modules/get-latest-scan-results');

const checkScansJob = require('./jobs/check-scans');
const updateCacheJob = require('./jobs/update-cache');
const clearCheckouts = require('./jobs/clear-checkouts');
const updateBarters = require('./jobs/update-barters');

const app = express();
const port = process.env.PORT || 4000;

let myData = false;

const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: fromEnv(),
});

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(basicAuth({
    challenge: true,
    realm: 'tarkov-data-manager',
    users: {
        'kokarn': process.env.AUTH_PASSWORD,
    },
}));

const urlencodedParser = bodyParser.urlencoded({ extended: false })

try {
    fs.mkdirSync(path.join(__dirname, 'cache'));
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
];

const CUSTOM_HANDLERS = [
    'untagged',
    'no-icon',
    'no-image',
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
                    if(item.image_link !== ''){
                        continue;
                    }

                    break;
                case 'no-icon':
                    if(item.icon_link !== ''){
                        continue;
                    }

                    break;

                case 'no-wiki':
                    if(item.wiki_link !== ''){
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
                    <a href="/edit/${item.id}">Edit</a>
                </div>
            </td>
            <td>
                <img src="${item.image_link}" loading="lazy" />
            </td>
            <td>
                <img src="${item.icon_link}" loading="lazy" />
            </td>
            <td>
                <img src="${item.grid_image_link}" loading="lazy" />
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

const getHeader = () => {
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
                                .map(type => `<li><a href="/items/?type=${type}">${capitalizeFirstLetter(type)}</a></li>`)
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

app.post('/edit/:id', urlencodedParser, async (req, res) => {
    console.log(req.body);
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);

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
        return res.redirect(`/edit/${req.params.id}?updated=1`);
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
        return res.redirect(`/edit/${req.params.id}?updated=1`);
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
        return res.redirect(`/edit/${req.params.id}?updated=1`);
    }

    if(req.body['wiki-link'] && req.body['wiki-link'] !== 'null' && currentItemData.wiki_link !== req.body['wiki-link']){
        await remoteData.setProperty(req.params.id, 'wiki_link', req.body['wiki-link']);
        return res.redirect(`/edit/${req.params.id}?updated=1`);
    }

    res.send('No changes made');
});

app.get('/edit/:id', async (req, res) => {
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);

    // return res.send(currentItemData);

    // console.log(currentItemData);

    return res.send(`${getHeader()}
        ${req.query.updated ? '<div class="row">Updated. Will be live in < 4 hours</div>': ''}
        <div class="row">
            <div class"col s6">
                ${currentItemData.name}
            </div>
            <div class"col s6">
                ${currentItemData.id}
            </div>
        </div>
        <div class="row">
            <form class="col s12" method="post" action="/edit/${currentItemData.id}">
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
                    ${currentItemData.wiki_link}
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

app.get('/items/', async (req, res) => {
    console.time('getting-items');
    myData = await remoteData.get();
    console.timeEnd('getting-items');
    res.send(`${getHeader()}
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
                    type: req.query.type,
                })}
            </tbody>
        </table>
    `);
});

app.get('/', async (req, res) => {
    const latestScanResults = await getLatestScanResults();
    res.send(`${getHeader()}
        <div class="scanners-wrapper">
            ${latestScanResults.map((latestScan) => {
                return `
                <div class="scanner">
                    <ul>
                        <li>
                            Name: ${latestScan.source}
                        </li>
                        <li>
                            Latest update: ${latestScan.timestamp}
                        </li>
                    </ul>
                    <div
                        class = "log-messages log-messages-${latestScan.source}"
                    >
                    </div>
                    <script>
                        startListener('${latestScan.source}');
                    </script>
                </div>`;
            }).join('')}
        </div>
    `);
});

const server = app.listen(port, () => {
    console.log(`Tarkov Data Manager listening at http://localhost:${port}`)
});

const checkScansJobSchedule = schedule.scheduleJob('20 * * * *', checkScansJob);
const updateCacheJobSchedule = schedule.scheduleJob('* * * * *', updateCacheJob);
const clearCheckoutJobSchedule = schedule.scheduleJob('5 4 */6 * *', clearCheckouts);
const updateBartersJobSchedule = schedule.scheduleJob('5 14 * * *', updateBarters);

const wss = new WebSocket.Server({
    server: server,
});

const pingMessage = JSON.stringify({type: 'ping'})

const sendCommand = (sessionID, command) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.sessionID === sessionID ) {
            client.send(JSON.stringify({
                type: 'command',
                data: command,
            }));
        }
    });
};

const sendMessage = (sessionID, type, data) => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.sessionID === sessionID ) {
            client.send(JSON.stringify({
                type: type,
                data: data,
            }));
        }
    });
};

const pingInterval = setInterval(() => {
    console.log(`active clients: ${wss.clients.size}`);

    wss.clients.forEach((client) => {
        if (client.isAlive === false) {
            return client.terminate();
        }

        client.isAlive = false;
        client.send(pingMessage);
    });
}, 5000);

wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('message', (rawMessage) => {
        const message = JSON.parse(rawMessage);

        console.log(message);

        if(message.type === 'pong'){
            ws.isAlive = true;

            return true;
        }

        if(message?.type !== 'debug'){
            console.log(message);
        }

        if(message.type === 'connect'){
            ws.sessionID = message.sessionID;

            return true;
        }

        if(message.type === 'command'){
            sendCommand(message.sessionID, message.data);

            return true;
        }

        if(message.type === 'debug'){
            sendMessage(message.sessionID, 'debug', message.data);

            return true;
        }
    });
});

wss.on('close', () => {
    clearInterval(pingInterval);
});