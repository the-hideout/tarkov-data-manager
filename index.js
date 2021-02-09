const fs = require('fs');
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const got = require('got');
const Jimp = require('jimp');
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const {fromEnv} = require('@aws-sdk/credential-provider-env');

// const getData = require('./modules/get-data');
const remoteData = require('./modules/remote-data');
const idIcon = require('./modules/id-icon');
const { connect } = require('http2');
const Connection = require('mysql/lib/Connection');
const { response } = require('express');

const workerData = require('./modules/worker-data');

const app = express();
const port = process.env.PORT || 4000;

let myData = false;

s3 = new S3Client({
    region: 'eu-west-1',
    credentials: fromEnv(),
});

app.use(bodyParser.json());
app.use(express.static('public'));

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
];

const updateData = async (updateObject) => {
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

const getTableContents = async (filterObject) => {
    const myData = await remoteData.get();
    let tableContentsString = '';
    let maxItems = 3000;
    let items = 0;

    for(const [key, item] of myData){
        if(filterObject?.type){
            switch (filterObject.type){
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

                    const alternateIcon = await idIcon(item.id);
                    if(alternateIcon){
                        item.icon_link = await alternateIcon.getBase64Async(Jimp.MIME_JPEG);
                    }
                    item.fix_link = `/set-icon-image?item-id=${item.id}`;

                    break;
                default:
                    if(!item.types.includes(filterObject.type)){
                        continue;
                    }
            }
        }

        items = items + 1;
        let iconString = `<img src="${item.icon_link}" loading="lazy" />`;

        if(item.fix_link){
            iconString = `
                <a href="${item.fix_link}"><img src="${item.icon_link}" loading="lazy" /></a>
                <a href="/set-icon-image?item-id=${item.id}&image-url=${item.image_link}"><img src="${item.image_link}" loading="lazy" /></a>
            `;
        }
        tableContentsString = `${tableContentsString}
        <tr>
            <td class="name-column">
                <a href="${item.wiki_link}" >${item.name}</a>
                ${item.id}
            </td>
            <td>
                <img src="${item.image_link}" loading="lazy" />
            </td>
            <td>
                ${iconString}
            </td>
            ${getItemTypesMarkup(item)}
            <td>
                <img src="https://tarkov-data.s3.eu-north-1.amazonaws.com/${item.id}/latest.jpg" class="scan-image" loading="lazy">
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

app.get('/data', async (req, res) => {
    const allData = await remoteData.get();

    res.send(allData);
});

app.post('/update', (request, response) => {
    console.log(request.body);
    updateData(request.body);

    response.send('ok');
});

app.get('/update-workers', async (request, response) => {
    const itemData = await remoteData.get();
    console.log('Updating all worker items');
    const retryList = [];
    for(const [key, item] of itemData){
        // console.log(item);
        try {
            await workerData(item.id, item);
        } catch (workerUpdateError){
            retryList.push(item);
            console.error(workerUpdateError);
            console.log(item);
        }
    }

    console.log('Done updating all worker items');
    console.log('Retrying failed items');

    for(const item of retryList){
        try {
            await workerData(item.id, item);
        } catch (workerUpdateError){
            console.error(workerUpdateError);
        }
    }

    console.log('Done with all retries');

    response.send('ok');
});

app.get('/set-icon-image', async (request, response) => {
    let image;
    if(request.query['image-url']){
        image = await Jimp.read(request.query['image-url']);
    } else {
        image = await idIcon(request.query['item-id']);
    }

    if(!image){
        return response.send('Failed to add image');
    }

    const uploadParams = {
        Bucket: 'assets.tarkov-tools.com',
        Key: `${request.query['item-id']}-icon.jpg`,
        ContentType: 'image/jpeg',
    };

    uploadParams.Body = await image.getBufferAsync(Jimp.MIME_JPEG);

    try {
        await s3.send(new PutObjectCommand(uploadParams));
        console.log("Image saved to s3");
    } catch (err) {
        console.log("Error", err);
    }

    await remoteData.setProperty(request.query['item-id'], 'icon_link', `https://assets.tarkov-tools.com/${request.query['item-id']}-icon.jpg`);

    response.send('ok');
});

app.get('/', async (req, res) => {
    myData = await remoteData.get();
    res.send(`<!DOCTYPE html>
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
            <link rel="stylesheet" href="index.css" />
        </head>
        <body>
        ${AVAILABLE_TYPES.map(type => `<a href="/?type=${type}">${type}</a>`).join(' ')}
        <a href="/?type=untagged">untagged</a>
        <a href="/?type=no-image">no-image</a>
        <a href="/?type=no-icon">no-icon</a>
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
                        Tags
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
        <script src="index.js"></script>
    `);
});

app.listen(port, () => {
    console.log(`Tarkov Data Manager listening at http://localhost:${port}`)
});
