const fs = require('fs');
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');

const getData = require('./modules/get-data');

const app = express();
const port = process.env.PORT || 4000;

const myData = require('./data.json');

app.use(bodyParser.json());
app.use(express.static('public'));

try {
    fs.mkdirSync(path.join(__dirname, 'cache'));
} catch (createError){
    console.error(createError);
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
];

const updateData = (updateObject) => {
    if(!myData[updateObject.id].types){
        myData[updateObject.id].types = [];
    }

    if(updateObject.active === false && !myData[updateObject.id].types.includes(updateObject.type)){
        return true;
    }

    if(updateObject.active === false){
        myData[updateObject.id].types.splice(myData[updateObject.id].types.indexOf(updateObject.type), 1);
    }

    if(updateObject.active === true){
        myData[updateObject.id].types.push(updateObject.type);
    }

    fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(myData, null, 4));
}

const getItemTypesMarkup = (item) => {
    let markupString = '<td class="types-column">';
    for(const type of AVAILABLE_TYPES){
        markupString = `${markupString}
        <div class="type-wrapper">
            <label for="${item.bsgId}-${type}">
                <input type="checkbox" id="${item.bsgId}-${type}" value="${type}" data-item-id="${item.bsgId}" ${myData[item.bsgId].types?.includes(type) ? 'checked' : ''} />
                <span>${type}</span>
            </label>
        </div>`;
    }

    markupString = `${markupString}</td>`;

    return markupString;
};

const getTableContents = async (filterObject) => {
    const allData = await getData();
    let tableContentsString = '';
    let maxItems = 3000;
    let items = 0;

    for(const item of allData){
        if(filterObject?.untagged && myData[item.bsgId].types.length > 0){
            continue;
        }

        if(filterObject?.type && !myData[item.bsgId].types.includes(filterObject.type)){
            continue;
        }

        items = items + 1;
        tableContentsString = `${tableContentsString}
        <tr>
            <td>
                ${item.bsgId}
            </td>
            <td class="name-column">
                <a href="${item.wikiLink}" >${item.name}</a>
            </td>
            <td>
                <img src="${item.img || myData[item.bsgId].img}" loading="lazy" />
            </td>
            <td>
                hor? ${Number(myData[item.bsgId].horizontal)}
            </td>
            <td>
                ${item.bsgType}
            </td>
            ${getItemTypesMarkup(item)}
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
    const allData = await getData();

    res.send(allData);
});

app.post('/update', (request, response) => {
    console.log(request.body);
    updateData(request.body);

    response.send('ok');
});

app.get('/', async (req, res) => {
    res.send(`<!DOCTYPE html>
        <head>
            <title>Tarkov Data Studio</title>

            <!-- Compiled and minified CSS -->
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">

            <!-- Compiled and minified JavaScript -->
            <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
            <link rel="stylesheet" href="index.css" />
        </head>
        <body>
        <table>
            <thead>
                <tr>
                    <th>
                        ID
                    </th>
                    <th>
                        Name
                    </th>
                    <th>
                        Image
                    </th>
                    <th>
                        Hor
                    </th>
                    <th>
                        Type
                    </th>
                    <th>
                        Tags
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

app.get('/untagged', async (req, res) => {
    res.send(`<!DOCTYPE html>
        <head>
            <title>Tarkov Data Studio</title>
            <link rel="stylesheet" href="index.css" />

            <!-- Compiled and minified CSS -->
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">

            <!-- Compiled and minified JavaScript -->
            <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
            <link rel="stylesheet" href="index.css" />
        </head>
        <body>
        <table>
            <thead>
                <tr>
                    <th>
                        ID
                    </th>
                    <th>
                        Name
                    </th>
                    <th>
                        Image
                    </th>
                    <th>
                        Hor
                    </th>
                    <th>
                        Type
                    </th>
                    <th>
                        Tags
                    </th>
                </tr>
            </thead>
            <tbody>
                ${ await getTableContents({
                    untagged: true,
                })}
            </tbody>
        </table>
        <script src="index.js"></script>
    `);
});

app.listen(port, () => {
    console.log(`Tarkov Data Manager listening at http://localhost:${port}`)
});
