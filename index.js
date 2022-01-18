const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
const timer = require('./modules/console-timer');

vm.runInThisContext(fs.readFileSync(__dirname + '/public/common.js'))

const rollbar = new Rollbar({
    accessToken: process.env.ROLLBAR_TOKEN,
    captureUncaught: true,
    captureUnhandledRejections: true
});

const app = express();
const port = process.env.PORT || 4000;

let myData = false;

const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: fromEnv(),
});

function maybe(fn) {
    return function(req, res, next) {
        if (req.path === '/suggest-image' && req.method === 'POST') {
            next();

            return true;
        }

        if(req.path.substring(0, 6) === '/data/'){
            next ();

            return true;
        }

        fn(req, res, next);
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

    myData = updateData;
};

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

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
    if (req.url === '/') {
        javascript += `
            <script>
                const WS_PASSWORD = '${process.env.WS_PASSWORD}';
            </script>
        `;
    }
    return `
    <!DOCTYPE html>
        <head>
            <title>Tarkov Data Studio</title>

            <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
            <link rel="stylesheet" href="https://cdn.datatables.net/1.10.23/css/jquery.dataTables.min.css">
            <script src="https://cdn.datatables.net/1.10.23/js/jquery.dataTables.min.js"></script>

            <!-- Compiled and minified CSS -->
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css">

            <!-- Compiled and minified JavaScript -->
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
            <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
            <link rel="manifest" href="/site.webmanifest">
            <meta name="msapplication-TileColor" content="#da532c">
            <meta name="theme-color" content="#ffffff">
            <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            <link rel="stylesheet" href="/index.css" />
            ${javascript}
        </head>
        <body>
            <script src="/ansi_up.js"></script>
            <script src="/common.js"></script>
            <script>
                $(document).ready(function(){
                    $('.sidenav').sidenav();
                });
            </script>
            <nav>
                <div class="nav-wrapper">
                    <a href="#" data-target="mobile-menu" class="sidenav-trigger"><i class="material-icons">menu</i></a>
                    <ul id="nav-mobile" class="left hide-on-med-and-down">
                        <li class="${req.url === '/' ? 'active' : ''}"><a href="/">Scanners</a></li>
                        ${
                            AVAILABLE_TYPES
                                .concat(CUSTOM_HANDLERS)
                                .sort()
                                .map(type => `<li class="${req.params && req.params.type === type ? 'active' : ''}"><a href="/items/${type}">${capitalizeFirstLetter(type)}</a></li>`)
                                .join(' ')
                        }
                    </ul>
                </div>
            </nav>
            <ul class="sidenav" id="mobile-menu">
                <li class="${req.url === '/' ? 'active' : ''}"><a href="/">Scanners</a></li>
                ${
                    AVAILABLE_TYPES
                        .concat(CUSTOM_HANDLERS)
                        .sort()
                        .map(type => `<li class="${req.params && req.params.type === type ? 'active' : ''}"><a href="/items/${type}">${capitalizeFirstLetter(type)}</a></li>`)
                        .join(' ')
                }
            </ul>
        `;
}

const getFooter = (req) => {
    return `
            <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
        </body>
    </html>`;
};

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

        if(fields.type !== 'grid-image' && fields.type !== 'icon' && fields.type !== 'image' && fields.type !== 'base-image'){
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
                    error: 'That item ID already has an image',
                });
        }

        if(fields.type === 'base-image' && currentItemData.base_image_link){
            return response
                .status(400)
                .send({
                    error: 'That item ID already has a base image',
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

        let ext = 'jpg';
        let contentType = 'image/jpeg';
        let MIME = Jimp.MIME_JPEG;
        if(fields.type === 'base-image'){
            ext = 'png';
            contentType = 'image/png';
            MIME = Jimp.MIME_PNG;
        }

        const uploadParams = {
            Bucket: 'assets.tarkov-tools.com',
            Key: `${fields.id}-${fields.type}.${ext}`,
            ContentType: contentType,
            CacheControl: 'max-age=604800',
        };

        uploadParams.Body = await image.getBufferAsync(MIME);

        try {
            await s3.send(new PutObjectCommand(uploadParams));
            console.log("Image saved to s3");
        } catch (err) {
            console.log("Error", err);

            return response.send(err);
        }

        if(fields.type !== 'base-image'){
            try {
                await remoteData.setProperty(fields.id, `${fields.type.replace(/\-/g, '_')}_link`, `https://assets.tarkov-tools.com/${fields.id}-${fields.type}.jpg`);
            } catch (updateError){
                console.error(updateError);
                return response.send(updateError);
            }
        }

        console.log(`${fields.id} ${fields.type} updated`);

        response.send('ok');
    });
});

app.post('/items/edit/:id', urlencodedParser, async (req, res) => {
    console.log(req.body);
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);
    let updated = false;
    const response = {success: false, message: 'No changes made.', errors: []};

    if(req.body['icon-link'] && req.body['icon-link'] !== 'null' && currentItemData.icon_link !== req.body['icon-link']){
        console.log('Updating icon link');
        let image = false;
        try {
            image = await Jimp.read(req.body['icon-link']);
        } catch (someError){
            console.error(someError);
        }

        if(!image){
            response.errors.push(`Failed to add icon_link image from ${req.body['icon-link']}`);
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

            response.errors.push(`Failed to save icon_link image to s3 ${err}`);
        }

        await remoteData.setProperty(req.params.id, 'icon_link', `https://assets.tarkov-tools.com/${req.params.id}-icon.jpg`);
        updated = true;
    }

    if(req.body['image-link'] && req.body['image-link'] !== 'null' && currentItemData.image_link !== req.body['image-link']){
        console.log('Updating image link');
        let image = await Jimp.read(req.body['image-link']);

        if(!image){
            response.errors.push(`Failed to add image_link image from ${req.body['image-link']}`);
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

            response.errors.push(`Failed to save image_link image to s3 ${err}`);
        }

        await remoteData.setProperty(req.params.id, 'image_link', `https://assets.tarkov-tools.com/${req.params.id}-image.jpg`);
        updated = true;
    }

    if(req.body['grid-image-link'] && req.body['grid-image-link'] !== 'null' && currentItemData.grid_image_link !== req.body['grid-image-link']){
        let image = await Jimp.read(req.body['grid-image-link']);

        if(!image){
            response.errors.push(`Failed to add grid_image_link image from ${req.body['grid-image-link']}`);
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

            response.errors.push(`Failed to save grid_image_link image to s3 ${err}`);
        }

        await remoteData.setProperty(req.params.id, 'grid_image_link', `https://assets.tarkov-tools.com/${req.params.id}-grid-image.jpg`);
        updated = true;
    }

    if(req.body['wiki-link'] && req.body['wiki-link'] !== 'null' && currentItemData.wiki_link !== req.body['wiki-link']){
        await remoteData.setProperty(req.params.id, 'wiki_link', req.body['wiki-link']);
        updated = true;
    }

    if (req.body['match-index'] && req.body['match-index'] !== 'null' && currentItemData.match_index !== req.body['match-index']) {
        await remoteData.setProperty(req.params.id, 'match_index', req.body['match-index']);
        updated = true;
    }

    if (updated) {
        response.success = true;
        response.message = `${currentItemData.name} updated.<br>Will be live in < 4 hours.`;
    }
    res.send(response);
});

app.get('/items/:type', async (req, res) => {
    const t = timer('getting-items');
    myData = await remoteData.get();
    const items = [];
    const attributes = [
        'id', 
        'name', 
        'shortname', 
        'types', 
        'normalized_name',
        'wiki_link',
        'icon_link',
        'grid_image_link',
        'image_link',
        'match_index',
        'avg24hPrice',
        'lastLowPrice'
    ];
    for (const [key, item] of myData) {
        if (req.params.type !== 'all') {
            if (!item.types.includes(req.params.type) && !CUSTOM_HANDLERS.includes(req.params.type)) {
                continue;
            } else if (CUSTOM_HANDLERS.includes(req.params.type)) {
                if (req.params.type == 'untagged') {
                    if (item.types.length > 0) {
                        continue;
                    }
                } else if (req.params.type == 'missing-image') {
                    if ((item.image_link && item.icon_link && item.grid_image_link) || item.types.includes('disabled')) {
                        continue;
                    }
                } else if (req.params.type == 'no-wiki') {
                    if (item.wiki_link) {
                        continue;
                    }
                }
            }
        }
        const newItem = {};
        for (let i = 0; i < attributes.length; i++) {
            const attribute = attributes[i];
            newItem[attribute] = item[attribute];
        }
        items.push(newItem);
    }
    t.end();
    res.send(`${getHeader(req)}
        <script src="/items.js"></script>
        <script>
        const all_items = ${JSON.stringify(items, null, 4)};
        </script>
        <table class="highlight main">
            <thead>
                <tr>
                    <th>
                        Name
                    </th>
                    <th>
                        Image
                    </th>
                    <th>
                        Grid image
                    </th>
                    <th>
                        Icon
                    </th>
                    <th>
                        Tags
                    </th>
                    <th>
                        Price
                    </th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        </table>
        <div id="modal-edit-item" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4 class="item-content-name"></h4>
                <p class="item-content-id"></p>
                <div class="row">
                    <form class="col s12 post-url item-attribute-id" data-attribute="action" data-prepend-value="/items/edit/" method="post" action="">
                        <div class="row">
                            <div class="input-field col s2 item-image-image_link"></div>
                            <div class="input-field col s10">
                                <input value="" id="image-link" type="text" class="validate item-value-image_link" name="image-link">
                                <label for="image-link">Image Link</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2 item-image-icon_link"></div>
                            <div class="input-field col s10">
                                <input value="" id="icon-link" type="text" class="validate item-value-icon_link" name="icon-link">
                                <label for="icon-link">Icon Link</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2 item-image-grid_image_link"></div>
                            <div class="input-field col s10">
                                <input value="" id="grid-image-link" type="text" class="validate item-value-icon_link" name="grid-image-link">
                                <label for="grid-image-link">Grid image link</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2">
                                <a class="item-attribute-wiki_link" data-attribute="href" href="">WIKI</a>
                            </div>
                            <div class="input-field col s10">
                                <input value="" id="wiki-link" type="text" class="validate item-value-wiki_link" name="wiki-link">
                                <label for="wiki-link">wiki link</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2 item-match_index"></div>
                            <div class="input-field col s10">
                                <input value="" id="match-index" type="text" class="validate item-value-match_index" name="match-index">
                                <label for="match-index">Match index</label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-item-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat edit-item-cancel">Cancel</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/', async (req, res) => {
    const latestScanResults = await getLatestScanResults();
    const activeScanners = [];
    const inactiveScanners = [];
    latestScanResults.map(latestScan => {
        if (new Date - latestScan.timestamp > 1000 * 60 * 60 * 2) {
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
                    <div class="collapsible-header">
                        <span class="tooltipped" data-tooltip="${scanner.timestamp}" data-position="right" style="vertical-align: middle">
                            <!--button class="waves-effect waves-light btn-small shutdown-scanner" type="button" data-scanner-name="${encodeURIComponent(scanner.source)}"><i class="material-icons left">power_settings_new</i>${scanner.source}</button-->
                            <a class="dropdown-trigger btn scanner-dropdown" href="#" data-target="dropdown-${scanner.source}"><i class="material-icons left">arrow_drop_down</i>${scanner.source}</a>
                            <ul id="dropdown-${scanner.source}" class="dropdown-content">
                                <li class="pause-scanner" data-scanner-name="${encodeURIComponent(scanner.source)}"><a href="#!" class="pause-scanner"><i class="material-icons left">pause</i>Pause</a></li>
                                <li class="resume-scanner" data-scanner-name="${encodeURIComponent(scanner.source)}" style="display:none;"><a href="#!" class="resume-scanner"><i class="material-icons left">play_arrow</i>Resume</a></li>
                                <li class="generate-images-scanner" data-scanner-name="${encodeURIComponent(scanner.source)}"><a href="#!" class="generate-images-scanner"><i class="material-icons left">image</i>Generate Images</a></li>
                                <li class="set-trader-scan-day" data-scanner-name="${encodeURIComponent(scanner.source)}"><a href="#!" class="set-trader-scan-day"><i class="material-icons left">schedule</i>Set Trader Scan Day</a></li>
                                <li class="shutdown-scanner" data-scanner-name="${encodeURIComponent(scanner.source)}"><a href="#!" class="shutdown-scanner"><i class="material-icons left">power_settings_new</i>Shutdown</a></li>
                            </ul>
                        </span>
                    </div>
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
        <script src="/scanners.js"></script>
        <h5>Active Scanners</h5>
        <div class="scanners-wrapper">
            ${activeScanners.map((latestScan) => {
                return getScannerStuff(latestScan, true);
            }).join('')}
        </div>
        <h5>Inactive Scanners</h5>
        <div class="scanners-wrapper">
        ${inactiveScanners.map(latestScan => {
            return getScannerStuff(latestScan, false);
        }).join('')}
        </div>
        <div id="modal-shutdown-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Shutdown</h4>
                <p>Are you sure you want to shutdown <span class="modal-shutdown-confirm-scanner-name"></span>?</p>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat shutdown-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat shutdown-cancel">No</a>
            </div>
        </div>
        <div id="modal-trader-scan-day" class="modal">
            <div class="modal-content">
                <h4>Set Trader Scan Day</h4>
                <p>Select the day you want <span class="modal-trader-scan-day-scanner-name"></span> to scan trader prices.</p>
                <select class="trader-scan-day">
                    <option value="false">Disable</option>
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                </select>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat trader-scan-day-confirm">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat trader-scan-day-cancel">Cancel</a>
            </div>
        </div>
    ${getFooter(req)}`);
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
            connection.end();
            process.exit();
        });
    };
    //gracefully shutdown on Ctrl+C
    process.on( 'SIGINT', triggerShutdown);
    //gracefully shutdown on Ctrl+Break
    process.on( 'SIGBREAK', triggerShutdown);
    //try to gracefully shutdown on terminal closed
    process.on( 'SIGHUP', triggerShutdown);
})();