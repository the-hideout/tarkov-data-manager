const fs = require('fs');
const path = require('path');
const vm = require('vm');

const express = require('express');
const bodyParser = require('body-parser');
const session = require('cookie-session');
const chalk = require('chalk');
const Sentry = require("@sentry/node");
const formidable = require('formidable');
const AdmZip = require('adm-zip');

if (process.env.NODE_ENV !== 'production') {
    const dotenv = require("dotenv");
    dotenv.config({path : './creds.env'});
    dotenv.config({path : './config.env'});
    process.env.NODE_ENV = 'dev';
} else {
    Sentry.init({
        dsn: "https://3728e31ab2d4455882f916fdea255a61@o1189140.ingest.sentry.io/6326844",
      
        // Set tracesSampleRate to 1.0 to capture 100%
        // of transactions for performance monitoring.
        // We recommend adjusting this value in production
        tracesSampleRate: 1.0,
      });
}

const remoteData = require('./modules/remote-data');
const jobs = require('./jobs');
const {connection, query, format} = require('./modules/db-connection');
const timer = require('./modules/console-timer');
const scannerApi = require('./modules/scanner-api');
const webhookApi = require('./modules/webhook-api');
const publicApi = require('./modules/public-api');
const { uploadToS3, getImages, getLocalBucketContents, addFileToBucket, deleteFromBucket, renameFile, copyFile } = require('./modules/upload-s3');
const { createAndUploadFromSource, regenerateFromExisting } = require('./modules/image-create');
const webSocketServer = require('./modules/websocket-server');

vm.runInThisContext(fs.readFileSync(__dirname + '/public/common.js'))

const app = express();
const port = process.env.PORT || 4000;

function maybe(fn) {
    return function(req, res, next) {
        if (req.path === '/auth' && req.method === 'POST') {
            next();

            return true;
        }

        if(req.path.substring(0, 6) === '/data/'){
            next();

            return true;
        }

        if (req.path.startsWith('/api/scanner')) {
            next();

            return true;
        }

        if (req.path.startsWith('/api/webhooks')) {
            next();

            return true;
        }

        if (req.path.startsWith('/api/queue')) {
            next();

            return true;
        }

        if (req.path.startsWith('/api/goons')) {
            next();

            return true;
        }

        fn(req, res, next);
    }
};

const validJsonDirs = [
    'cache',
    'dumps',
];

const users = {
    "admin": process.env.AUTH_PASSWORD
};

const sess = {
    secret: process.env.AUTH_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {}
};
if (app.get('env') === 'production') {
    app.set('trust proxy', 1);
    sess.cookie.secure = true;
}

app.set('trust proxy', true);

//app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session(sess));
app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({extended: true}));
app.use(maybe((req, res, next) => {
    if (req.session.loggedin) {
        next();
    } else {
        res.send(`${getHeader(req)}
            <div class="container">
                <div class="row">
                    <form class="col s12">
                        <div class="row">
                            <div class="input-field col s12">
                                <input id="username" name="username" type="text" class="validate">
                                <label for="username">Username</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s12">
                                <input id="password" name="password" type="password" class="validate">
                                <label for="password">Password</label>
                            </div>
                        </div>
                        <a href="#" class="waves-effect waves-light btn">Login</a>
                    </form>
                </div>
            </div>
            <script>
                const attemptLogin = () => {
                    $.ajax({
                        type: "POST",
                        url: '/auth',
                        data: $('form').first().serialize(),
                        dataType: "json"
                    }).done(function (data) {
                        if (!data.success) {
                            M.toast({text: data.message});
                        } else {
                            location.reload();
                        }
                    });
                }
                $(document).ready(function(){
                    $('a.btn').click(function(){
                        attemptLogin();
                    });
                    $('input').keyup(function(e){
                        if(e.keyCode == 13) {
                            attemptLogin();
                        }
                    });
                    $('input#username').focus();
                });
            </script>
        ${getFooter(req)}`);
    }
}));
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

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

app.post('/auth', async (req, res) => {
    const response = {success: false, message: 'Invalid username/password.'};
    let username = req.body.username;
    let password = req.body.password;
    if (username && password) {
        if (users[username] && users[username] == password) {
            req.session.loggedin = true;
            req.session.username = username;
            response.success = true;
            response.message = 'Login successful!';
        }
    }
    res.send(response);
});

const getHeader = (req, options) => {
    const jsLibrary = {
        datatables: 'https://cdn.datatables.net/1.10.23/js/jquery.dataTables.min.js'
    };
    const cssLibrary = {
        datatables: 'https://cdn.datatables.net/1.10.23/css/jquery.dataTables.min.css'
    };
    let includeJs = '';
    let includeCss = '';
    if (typeof options === 'object' && options.include) {
        if (typeof options.include === 'string') {
            options.include = [options.include];
            for (let i = 0; i < options.include.length; i++) {
                if (jsLibrary[options.include[i]]) {
                    includeJs = `${includeJs}\n            <script src="${jsLibrary[options.include[i]]}"></script>`
                }
                if (cssLibrary[options.include[i]]) {
                    includeCss = `${includeCss}\n            <link rel="stylesheet" href="${cssLibrary[options.include[i]]}">`
                }
            }
        }
    }
    return `
    <!DOCTYPE html>
        <head>
            <title>Tarkov Data Manager</title>
            <!-- Compiled and minified CSS -->
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@materializecss/materialize@2.0.3-beta/dist/css/materialize.min.css">${includeCss}

            <!-- Compiled and minified JavaScript -->
            <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
            <script src="/common.js"></script>${includeJs}
            <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
            <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
            <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
            <link rel="manifest" href="/site.webmanifest">
            <meta name="msapplication-TileColor" content="#da532c">
            <meta name="theme-color" content="#ffffff">
            <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
            <link rel="stylesheet" href="/index.css" />
        </head>
        <body>
            <nav>
                <div class="nav-wrapper">
                    <a href="/" class="brand-logo right"><i class="material-icons">query_stats</i>Tarkov Data Manager</a>
                    <a href="#" data-target="mobile-menu" class="sidenav-trigger"><i class="material-icons">menu</i></a>
                    <ul id="nav-main" class="hide-on-med-and-down">
                        <li class="${req.url === '/scanners' ? 'active' : ''}"><a href="/scanners">Scanners</a></li>
                        <li class="${req.url === '/items' ? 'active' : ''}"><a href="/items">Items</a></li>
                        <li class="${req.url === '/webhooks' ? 'active' : ''}"><a href="/webhooks">Webhooks</a></li>
                        <li class="${req.url === '/crons' ? 'active' : ''}"><a href="/crons">Crons</a></li>
                        <li class="${req.url === '/json' ? 'active' : ''}"><a href="/json">JSON</a></li>
                        <li class="${req.url === '/s3-bucket' ? 'active' : ''}"><a href="/s3-bucket">S3 Bucket</a></li>
                        <li class="${req.url === '/wipes' ? 'active' : ''}"><a href="/wipes">Wipes</a></li>
                        <!--li class="${req.url === '/trader-prices' ? 'active' : ''}"><a href="/trader-prices">Trader Prices</a></li-->
                    </ul>
                </div>
            </nav>
            <ul class="sidenav" id="mobile-menu">
                <li class="${req.url === '/' ? 'active' : ''}"><a href="/">Home</a></li>
                <li class="${req.url === '/scanners' ? 'active' : ''}"><a href="/scanners">Scanners</a></li>
                <li class="${req.url === '/items' ? 'active' : ''}"><a href="/items">Items</a></li>
                <li class="${req.url === '/webhooks' ? 'active' : ''}"><a href="/webhooks">Webhooks</a></li>
                <li class="${req.url === '/crons' ? 'active' : ''}"><a href="/crons">Crons</a></li>
                <li class="${req.url === '/json' ? 'active' : ''}"><a href="/json">JSON</a></li>
                <li class="${req.url === '/s3-bucket' ? 'active' : ''}"><a href="/s3-bucket">S3 Bucket</a></li>
                <li class="${req.url === '/wipes' ? 'active' : ''}"><a href="/crons">Wipes</a></li>
                <!--li class="${req.url === '/trader-prices' ? 'active' : ''}"><a href="/trader-prices">Trader Prices</a></li-->
            </ul>
            <div class="container">
        `;
}

const getFooter = (req) => {
    let toastJs = '';
    if (req.query.toast) {
        toastJs = `M.toast({text: '${decodeToast(req.query.toast)}'});`;
    }
    return `
            </div>
            <footer class="page-footer"></footer>
            <script src="https://cdn.jsdelivr.net/npm/@materializecss/materialize@2.0.3-beta/dist/js/materialize.min.js"></script>
            <script>
                $(document).ready(function(){
                    //$('.sidenav').sidenav();
                    M.Sidenav.init($('.sidenav'), {});
                    ${toastJs}
                });
            </script>
        </body>
    </html>`;
};

app.get('/', async (req, res) => {
    const activeScanners = await query('SELECT id FROM scanner WHERE last_scan > DATE_SUB(NOW(),INTERVAL 5 MINUTE) OR trader_last_scan > DATE_SUB(NOW(),INTERVAL 5 MINUTE)');
    const imageFields = [
        'image_8x_link',
        'image_512_link',
        'image_link',
        'base_image_link',
        'grid_image_link',
        'icon_link',
    ];
    let itemCount = 0;
    const missingImage = [];
    let missingImageCount = 0;
    const missingWiki = [];
    let untagged = [];
    const myData = await remoteData.get();
    for (const [key, item] of myData) {
        if (item.types.length == 0) 
            untagged.push(item);
        
        let missingImages = 0;
        if (!item.types.includes('disabled')) {
            if (!item.wiki_link && !item.types.includes('quest')) {
                missingWiki.push(item);
            }
            for (const field of imageFields) {
                if (!item[field]) {
                    missingImages++;
                }
            }
        }
        if (missingImages > 0) {
            missingImage.push(item);
            missingImageCount += missingImages;
        }
        itemCount++;
    }
    res.send(`${getHeader(req)}
        <div class="row">
            <div class="section col s12">
                <h5><a href="/scanners" class="waves-effect waves-light btn"><i class="material-icons left">scanner</i>Scanners</a></h5>
                <ul class="browser-default">
                    <li>Active: ${activeScanners.length}</li>
                </ul>
            </div>
            <div class="divider col s12"></div>
            <div class="section col s12">
                <h5><a href="/items" class="waves-effect waves-light btn"><i class="material-icons left">search</i>Items</a></h5>
                <ul class="browser-default">
                    <li>Total: ${itemCount}</li>
                    ${untagged.length > 0 ? `<li>Untagged: ${untagged.length}</li>` : ''}
                    ${missingImage.length > 0 ? `<li>Missing image(s): ${missingImage.length} items missing ${missingImageCount} total images</li>` : '' }
                    ${missingWiki.length > 0 ? `<li>Missing wiki link: ${missingWiki.length}</li>` : '' }
                </ul>
            </div>
            <div class="section col s12">
                Running in ${process.env.NODE_ENV} mode.
            </div>
        </div>
    ${getFooter(req)}`);
});

/*app.get('/data', async (req, res) => {
    const allData = await remoteData.get();

    res.send(allData);
});*/

app.post('/items/update-types/:id', async (request, response) => {
    //console.log(request.body, request.params.id);
    const res = {errors: [], message: ''};
    try {
        if (request.body.active) {
            await remoteData.addType(request.params.id, request.body.type);
        } else {
            await remoteData.removeType(request.params.id, request.body.type);
        }
        res.message = 'ok';
    } catch (error) {
        res.errors.push(error.message);
    }

    response.send(res);
});

app.post('/items/regenerate-images/:id', async (req, res) => {
    const response = {success: false, message: 'Error regenerating images', errors: []};
    try {
        const results = await regenerateFromExisting(req.params.id);
        response.message = `Regenerated ${results.images.join(', ')} from ${results.source}`;
        response.success = true;
    } catch (error) {
        if (Array.isArray(error)) {
            response.errors = error.map(err => err.message || err);
        } else {
            response.errors.push(error.message || error);
        }
    }
    res.send(response);
});

app.get('/items/download-images/:id', async (req, res) => {
    const response = await getImages(req.params.id);
    const zip = new AdmZip();
    for (const image of response.images) {
        zip.addFile(image.filename, image.buffer);
    }
    if (response.errors.length > 0) {
        zip.addFile('errors.json', response.errors.join('\n'));
    }
    res.type('zip');
    res.send(zip.toBuffer());
});

app.post('/items/edit/:id', async (req, res) => {
    const allItemData = await remoteData.get();
    const currentItemData = allItemData.get(req.params.id);
    let updated = false;
    const response = {success: false, message: 'No changes made.', errors: []};
    const form = formidable.formidable({
        multiples: true,
        allowEmptyFiles: true,
        minFileSize: 0,
        uploadDir: path.join(__dirname, 'cache'),
    });
    const finish = (files) => {
        if (files) {
            for (const key in files.file) {
                let file = files.file[key][0];
                //console.log('removing', file.filepath);
                fs.rm(file.filepath, error => {
                    if (error) console.log(`Error deleting ${file.filepath}`, error);
                });
            }
        }
    };

    try {
        await new Promise((resolve, reject) => {
            form.parse(req, async (err, fields, files) => {
                if (err) {
                    finish(files);
                    return reject(err);
                }
                let sourceUpload = false;
                for (const index in files) {
                    if (index === 'source-upload' && files[index][0].size !== 0) {
                        sourceUpload = true;
                        break;
                    }
                }
                for (const index in files) {
                    let file = files[index][0];
                    if (file.size === 0) continue;
                    if (sourceUpload && index !== 'source-upload') {
                        continue;
                    }
                    try {
                        if (index === 'source-upload') {
                            await createAndUploadFromSource(file.filepath, req.params.id);
                            updated = true;
                            break;
                        }
                        const imageType = index.replace('-upload', '');
                        await uploadToS3(file.filepath, imageType, req.params.id);
                        updated = true;
                    } catch (error){
                        finish(files);
                        return reject(error);
                    }
                }

                let wikiLink = fields['wiki-link'][0];
                if(wikiLink && wikiLink !== 'null' && currentItemData.wiki_link !== wikiLink){
                    await remoteData.setProperty(req.params.id, 'wiki_link', wikiLink);
                    updated = true;
                }
            
                let matchIndex = fields['match-index'][0];
                if (matchIndex && matchIndex !== 'null' && currentItemData.match_index != matchIndex) {
                    await remoteData.setProperty(req.params.id, 'match_index', matchIndex);
                    updated = true;
                }
            
                if (updated) {
                    response.success = true;
                    response.message = `${currentItemData.name} updated.\nWill be live in < 4 hours.`;
                }
                finish(files);
                resolve();
            });
        });
    } catch (error) {
        if (Array.isArray(error)) {
            for (const err of error) {
                console.log(err);
                response.errors.push(err.message);
            }
        } else {
            console.log(error);
            response.errors.push(error.message);
        }
    }
    
    return res.send(response);
});

app.get('/items', async (req, res) => {
    let typeFilters = '';
    for(const type of AVAILABLE_TYPES){
        typeFilters = `${typeFilters}
        <div class="col s4 m3 l2">
            <label for="type-${type}">
                <input type="checkbox" class="filled-in filter-type" id="type-${type}" value="${type}" ${type === 'disabled' ? 'checked' : ''} />
                <span>${type}</span>
            </label>
        </div>`;
    }
    let specFilters = '';
    for(const type of CUSTOM_HANDLERS){
        specFilters = `${specFilters}
        <div class="col s4 m3 l2">
            <label for="type-${type}">
                <input type="checkbox" class="filled-in filter-special" id="type-${type}" value="${type}" ${type === 'all' ? 'checked' : ''} />
                <span>${type}</span>
            </label>
        </div>`;
    }
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/items.js"></script>
        <div class="row">
            <div class="col s12">
                <ul class="collapsible">
                    <li>
                        <div class="collapsible-header"><i class="material-icons left">filter_list</i>Item Filters</div>
                        <div class="collapsible-body">
                            <div>Item Types</div>
                            <div>
                                <a class="waves-effect waves-light btn filter-types-all"><i class="material-icons left">all_inclusive</i>All</a>
                                <a class="waves-effect waves-light btn filter-types-none"><i class="material-icons left">not_interested</i>None</a>
                            </div>
                            <div>
                                <label>
                                    <input class="filter-types-require-selected" name="type-filter-function" type="radio" value="any">
                                    <span>Require any</span>
                                </label>
                                <label>
                                    <input class="filter-types-require-selected" name="type-filter-function" type="radio" value="all">
                                    <span>Require all</span>
                                </label>
                                <label>
                                    <input class="filter-types-require-selected" name="type-filter-function" type="radio" value="none" checked>
                                    <span>Exclude</span>
                                </label>
                            </div>
                            <div class="row">${typeFilters}</div>
                            <div>Special Filters</div>
                            <div>
                                <a class="waves-effect waves-light btn filter-special-all"><i class="material-icons left">all_inclusive</i>All</a>
                                <a class="waves-effect waves-light btn filter-special-none"><i class="material-icons left">not_interested</i>None</a>
                            </div>
                            <div class="row">${specFilters}</div>
                        </div>
                    </li>
                </ul>
            </div>
        </div>
        <div class="row">
            <div class="col s12">
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                Name
                            </th>
                            <th>
                                Images
                            </th>
                            <th>
                                Tags
                            </th>
                            <!--th>
                                Price
                            </th-->
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-edit-item" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4 class="item-content name"></h4>
                <div class="item-content id"></div>
                <div class="row">
                    <form class="col s12 post-url item-attribute id" data-attribute="action" data-prepend-value="/items/edit/" method="post" action="">
                        <div class="row">
                            <div class="col s4">
                                <div>8x image</div>
                                <div class="input-field item-image image_8x_link"></div>
                                <div>Upload new 8x image</div>
                                <input id="image-8x-upload" class="single-upload" type="file" name="8x-upload" />
                            </div>
                            <div class="col s4">
                                <div>512px image</div>
                                <div class="input-field item-image image_512_link"></div>
                                <div>Upload new 512 image</div>
                                <input id="image-512-upload" class="single-upload" type="file" name="512-upload" />
                            </div>
                            <div class="col s4">
                                <div>Inspect image</div>
                                <div class="input-field item-image image_link"></div>
                                <div>Upload new inspect image</div>
                                <input id="image-upload" class="single-upload" type="file" name="image-upload" />
                            </div>
                        </div>
                        <div class="row">
                            <div class="col s4">
                                <div>Base image</div>
                                <div class="input-field item-image base_image_link"></div>
                                <div>Upload new base image</div>
                                <input id="base-image-upload" class="single-upload" type="file" name="base-image-upload" />
                            </div>
                            <div class="col s4">
                                <div>Grid image</div>
                                <div class="input-field item-image grid_image_link"></div>
                                <div>Upload new grid image</div>
                                <input id="grid-image-upload" class="single-upload" type="file" name="grid-image-upload" />
                            </div>
                            <div class="col s4">
                                <div>Icon</div>
                                <div class="input-field item-image icon_link"></div>
                                <div>Upload new icon</div>
                                <input id="icon-upload" class="single-upload" type="file" name="icon-upload" />
                            </div>
                        </div>
                        <div class="row">
                            <div class="col s12">
                                <div class="input-field item-image source-image"></div>
                                <div>Generate new images from source image</div>
                                <input id="source-upload" type="file" name="source-upload" />
                            </div>
                        </div>
                        <div class="row">
                            <div class="col s12">
                                <a href="" class="image-download">Download Images from S3</a>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2">
                                <a class="item-attribute wiki_link" data-attribute="href" href="">WIKI</a>
                            </div>
                            <div class="input-field col s10">
                                <input value="" id="wiki-link" type="text" class="validate item-value wiki_link" name="wiki-link" placeholder=" ">
                                <label for="wiki-link">wiki link</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field col s2 item-match_index"></div>
                            <div class="input-field col s10">
                                <input value="" id="match-index" type="text" class="validate item-value match_index" name="match-index" placeholder=" ">
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

app.get('/items/get', async (req, res) => {
    const t = timer('getting-items');
    const myData = await remoteData.get();
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
        'base_image_link',
        'image_link',
        'image_512_link',
        'image_8x_link',
        'match_index',
        'avg24hPrice',
        'lastLowPrice'
    ];
    for (const [key, item] of myData) {
        const newItem = {};
        for (let i = 0; i < attributes.length; i++) {
            const attribute = attributes[i];
            newItem[attribute] = item[attribute];
        }
        items.push(newItem);
    }
    t.end();
    res.json(items);
});

app.get('/scanners', async (req, res) => {
    const activeScanners = [];
    const inactiveScanners = [];
    const scanners = await query(`
        SELECT scanner.*, COALESCE(scanner_user.flags, 0) as flags, COALESCE(scanner_user.disabled, 1) as disabled FROM scanner
        LEFT JOIN scanner_user on scanner_user.id = scanner.scanner_user_id
    `);
    const clients = webSocketServer.connectedScanners();
    const userFlags = scannerApi.getUserFlags();
    const scannerFlags = scannerApi.getScannerFlags();
    clients.forEach(client => {
        const scanner = scanners.find(s => s.name === client.sessionId);
        if (!scanner) {
            return;
        }
        if (scanner.disabled) return;
        if (!(scanner.flags & userFlags.insertPlayerPrices) && !(scanner.flags & userFlags.insertTraderPrices)) return;
        let mostRecentScan = scanner.last_scan > scanner.trader_last_scan ? scanner.last_scan : scanner.trader_last_scan;
        mostRecentScan = mostRecentScan ? mostRecentScan : 0;
        if (client.status === 'scanning') {
            activeScanners.push({...scanner, timestamp: mostRecentScan});
        } else {
            inactiveScanners.push({...scanner, timestamp: mostRecentScan});
        }
    });
    let scannerFlagsString = '';
    for (const flagName in scannerFlags) {
        const flagValue = scannerFlags[flagName];
        if (!flagValue) continue;
        const flagLabel = flagName.replace(/[A-Z]/g, capLetter => {
            return ' '+capLetter.toLowerCase();
        });
        scannerFlagsString = `${scannerFlagsString}
        <div class="col s12 l6 xl4 xxl3">
            <label for="scanner-flag-${[flagName]}">
                <input type="checkbox" class="scanner-flag" id="scanner-flag-${[flagName]}" value="${flagValue}" />
                <span>${flagLabel}</span>
            </label>
        </div>
        `;
    }
    const getScannerStuff = (scanner, active) => {
        let activeClass = '';
        if (active) {
            activeClass = ' active';
        }
        return `
        <div class="scanner col s12 xl6">
            <ul class="collapsible" data-collapsible="collapsible">
                <li class="${activeClass}">
                    <div class="collapsible-header">
                        <span class="tooltipped" data-tooltip="${scanner.timestamp}" data-position="right" style="vertical-align: middle">
                            <!--button class="waves-effect waves-light btn-small shutdown-scanner" type="button" data-scanner-name="${encodeURIComponent(scanner.name)}"><i class="material-icons left">power_settings_new</i>${scanner.name}</button-->
                            <a class="dropdown-trigger btn scanner-dropdown" href="#" data-target="dropdown-${scanner.name}"><i class="material-icons left">arrow_drop_down</i>${scanner.name}</a>
                            <ul id="dropdown-${scanner.name}" class="dropdown-content">
                                <li class="pause-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="pause-scanner"><i class="material-icons left">pause</i>Pause</a></li>
                                <li class="resume-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}" style="display:none;"><a href="#!" class="resume-scanner"><i class="material-icons left">play_arrow</i>Resume</a></li>
                                <!--li class="screenshot-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="screenshot-scanner"><i class="material-icons left">camera_alt</i>Screenshot</a></li-->
                                <li class="click-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="click-scanner"><i class="material-icons left">mouse</i>Click</a></li>
                                <li class="update-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="update-scanner"><i class="material-icons left">system_update_alt</i>Update</a></li>
                                <!--li class="log-repeat-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="log-repeat-scanner"><i class="material-icons left">event_note</i>Repeat log</a></li-->
                                <li class="generate-images-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="generate-images-scanner"><i class="material-icons left">image</i>Generate Images</a></li>
                                <li class="set-trader-scan-day" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="set-trader-scan-day"><i class="material-icons left">schedule</i>Set Trader Scan Day</a></li>
                                <li class="restart-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="restart-scanner"><i class="material-icons left">refresh</i>Restart</a></li>
                                <li class="shutdown-scanner" data-scanner-name="${encodeURIComponent(scanner.name)}"><a href="#!" class="shutdown-scanner"><i class="material-icons left">power_settings_new</i>Shutdown</a></li>
                            </ul>
                        </span>
                    </div>
                    <div class="collapsible-body log-messages log-messages-${scanner.name}"></div>
                    <script>
                        startListener('${scanner.name}');
                    </script>
                </li>
            </ul>
        </div>
        `;
    };
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script>
            const WS_PASSWORD = '${process.env.WS_PASSWORD}';
            const userFlags = ${JSON.stringify(userFlags)};
        </script>
        <script src="/ansi_up.js"></script>
        <script src="/scanners.js"></script>
        <div class="row">
            <div class="col s12">
                <ul class="tabs">
                    <li class="tab col s4"><a href="#activescanners" class="active">Active Scanners</a></li>
                    <li class="tab col s4"><a href="#inactivescanners">Inactive Scanners</a></li>
                    <li class="tab col s4"><a href="#scannerusers">Scanner Users</a></li>
                </ul>
            </div>
            <div id="activescanners" class="col s12">
                <div class="scanners-wrapper row">
                    ${activeScanners.map((latestScan) => {
                        return getScannerStuff(latestScan, true);
                    }).join('')}
                </div>
            </div>
            <div id="inactivescanners" class="col s12">
                <div class="scanners-wrapper row">
                    ${inactiveScanners.map((latestScan) => {
                        return getScannerStuff(latestScan, true);
                    }).join('')}
                </div>
            </div>
            <div id="scannerusers" class="col s12">
                <div class="scanner-userss-wrapper">
                    <a href="#" class="waves-effect waves-light btn add-user tooltipped" data-tooltip="Add API user"><i class="material-icons">person_add</i></a>
                    <table class="highlight main">
                        <thead>
                            <tr>
                                <th>
                                    Username
                                </th>
                                <th>
                                    Password
                                </th>
                                <th>
                                    Scanners
                                </th>
                                <th>
                                    Flags
                                </th>
                                <th>
                                    Disabled
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        <div id="modal-restart-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Restart</h4>
                <div>Are you sure you want to restart <span class="modal-restart-confirm-scanner-name"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat restart-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat restart-cancel">No</a>
            </div>
        </div>
        <div id="modal-shutdown-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Shutdown</h4>
                <div>Are you sure you want to shutdown <span class="modal-shutdown-confirm-scanner-name"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat shutdown-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat shutdown-cancel">No</a>
            </div>
        </div>
        <div id="modal-trader-scan-day" class="modal">
            <div class="modal-content">
                <h4>Set Trader Scan Day</h4>
                <div>Select the day you want <span class="modal-trader-scan-day-scanner-name"></span> to scan trader prices.</div>
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
        <div id="modal-click" class="modal">
            <div class="modal-content">
                <h4 class="scanner-click-name">Click Point on Screen</h4>
                <div>Click the screen position you want to click.</div>
                <div><img src="" class="scanner-last-screenshot" style="max-width: 100%" /></div>
                <div class="row">
                    <div class="input-field col s3">
                        <input id="click-x" type="number" value="0" class="validate click-x" />
                        <label for="click-x">Pixels from left</label>
                    </div>
                    <div class="input-field col s3">
                        <input id="click-y" type="number" value="0" class="validate click-y" />
                        <label for="click-y">Pixels from top</label>
                    </div>
                    <div class="col s2 offset-s4">
                        <a href="#!" class="waves-effect waves-green btn refresh-screenshot">
                            <i class="material-icons">refresh</i>
                        </a>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn-flat do-click">Click</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat do-click">Click & Close</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat click-cancel">Cancel</a>
            </div>
        </div>
        <div id="modal-edit-user" class="modal modal-fixed-footer">
            <div class="modal-content">
                <div class="row">
                    <form class="col s12 post-url" method="post" action="">
                        <input id="user_id" name="user_id" class="user_id" type="hidden">
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="username" type="text" class="validate username" name="username" placeholder=" ">
                                <label for="username">Username</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="password" type="text" class="validate password" name="password" placeholder=" ">
                                <label for="password">Password</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field s2">
                                <input value="" id="max_scanners" type="text" class="validate max_scanners" name="max_scanners" placeholder=" ">
                                <label for="max_scanners">Max Scanners</label>
                            </div>
                        </div>
                        <div class="row">
                            <label for="user_disabled">
                                <input type="checkbox" class="user_disabled" id="user_disabled" name="user_disabled" value="1"/>
                                <span>disabled</span>
                            </label>
                        </div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-user-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat edit-user-cancel">Cancel</a>
            </div>
        </div>
        <div id="modal-edit-scanner" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4 class="scanner-name"></h4>
                <div class="row">
                    <form class="col s12 post-url" method="post" action="">
                        <input id="scanner_id" name="scanner_id" class="scanner_id" type="hidden">
                        <div class="row">
                            ${scannerFlagsString}
                        </div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat edit-scanner-cancel">Close</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/scanners/get-users', async (req, res) => {
    const results = await Promise.all([query(`SELECT * FROM scanner_user`), query(`SELECT * FROM scanner`)]);
    const users = results[0].map(user => {
        const scanners = [];
        for (const scanner of results[1]) {
            if (scanner.scanner_user_id === user.id) scanners.push(scanner);
        }
        return {
            ...user,
            scanners: scanners
        }
    });
    res.json(users);
});

app.post('/scanners/add-user', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    if (!req.body.username) {
        response.errors.push('Username cannot be blank');
    }
    if (!req.body.password) {
        response.errors.push('Password cannot be blank');
    }
    if (response.errors.length > 0) {
        res.send(response);
        return;
    }
    try {
        const userCheck = await query(format('SELECT * from scanner_user WHERE username=?', [req.body.username]));
        if (userCheck.length > 0) {
            response.errors.push(`User ${req.body.username} already exists`);
            res.send(response);
            return;
        }
    } catch (error) {
        response.errors.push(error.message);
        res.send(response);
        return;
    }
    try {
        const user_disabled = req.body.user_disabled ? 1 : 0;
        console.log('inserting user');
        await query(format('INSERT INTO scanner_user (username, password, disabled) VALUES (?, ?, ?)', [req.body.username, req.body.password, user_disabled]))
        scannerApi.refreshUsers();
        response.message = `Created user ${req.body.username}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    console.log('sending response', response);
    res.send(response);
});

app.post('/scanners/edit-user', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let id = req.body.user_id;
        let userCheck = await query(format('SELECT * from scanner_user WHERE id=?', [id]));
        if (userCheck.length == 0) {
            response.errors.push(`User not found`);
            res.send(response);
            return;
        }
        userCheck = userCheck[0];
        const updates = {};
        if (req.body.username && req.body.username !== userCheck.username) {
            updates.username = req.body.username;
        }
        if (req.body.password && req.body.password !== userCheck.password) {
            updates.password = req.body.password;
        }
        const disabled = req.body.user_disabled || 0;
        if (disabled != userCheck.disabled) {
            updates.disabled = disabled;
        }
        const updateFields = [];
        const updateValues = [];
        for (const field in updates) {
            updateFields.push(field);
            updateValues.push(updates[field]);
        }
        if (updateFields.length > 0) {
            await query(format(`UPDATE scanner_user SET ${updateFields.map(field => {
                return `${field} = ?`;
            }).join(', ')} WHERE id='${userCheck.id}'`, updateValues));
            scannerApi.refreshUsers();
            response.message = `Updated ${updateFields.join(', ')}`;
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.post('/scanners/delete-user', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let deleteResult = await query(format('DELETE FROM scanner_user WHERE username=?', [req.body.username]));
        if (deleteResult.affectedRows > 0) {
            response.message = `User ${req.body.username} deleted`;
            scannerApi.refreshUsers();
        } else {
            response.errors.push(`User ${req.body.username} not found`);
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.post('/scanners/user-flags', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await query(format('UPDATE scanner_user SET flags=? WHERE id=?', [req.body.flags, req.body.id]));
        response.message = `Set flags to ${req.body.flags}`;
        scannerApi.refreshUsers();
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.post('/scanners/scanner-flags', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await query(format('UPDATE scanner SET flags=? WHERE id=?', [req.body.flags, req.body.id]));
        response.message = `Set flags to ${req.body.flags}`;
        //scannerApi.refreshUsers();
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.get('/webhooks', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/webhooks.js"></script>
        <div class="row">
            <div class="col s12">
                <a href="#" class="waves-effect waves-light btn add-webhook tooltipped" data-tooltip="Add webhook"><i class="material-icons">add</i></a>
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                Webhook
                            </th>
                            <th>
                                URL
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-edit-webhook" class="modal modal-fixed-footer">
            <div class="modal-content">
                <div class="row">
                    <form class="col s12 post-url" method="post" action="">
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="name" type="text" class="validate name" name="name" placeholder=" ">
                                <label for="name">Name</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="url" type="text" class="validate url" name="url" placeholder=" ">
                                <label for="url">Discord Webhook URL</label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-webhook-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat edit-webhook-cancel">Cancel</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/webhooks/get', async (req, res) => {
    const webhooks = await query('SELECT * FROM webhooks');
    res.json(webhooks);
});

app.post('/webhooks', async (req, res) => {
    //add
    const response = {message: 'No changes made.', errors: []};
    if (!req.body.name) {
        response.errors.push('Name cannot be blank');
    }
    if (!req.body.url) {
        response.errors.push('URL cannot be blank');
    }
    if (response.errors.length > 0) {
        res.json(response);
        return;
    }
    const WEBHOOK_BASE = 'https://discord.com/api/webhooks/';
    let webhookUrl = req.body.url.replace(WEBHOOK_BASE, '');
    const pattern = /^\d+\/[a-zA-Z0-9-_]+$/;
    if (!webhookUrl.match(pattern)) {
        response.errors.push('Not a valid webhook url');
        res.json(response);
        return;
    }
    try {
        const hookCheck = await query('SELECT * FROM webhooks WHERE name=? OR url=?', [req.body.name, webhookUrl]);
        for (let i = 0; i < hookCheck.length; i++) {
            if (hookCheck[i].name === req.body.name) {
                response.errors.push(`Webhook with name ${req.body.name} already exists`);
            }
            if (hookCheck[i].url === webhookUrl) {
                response.errors.push(`Webhook with url ${webhookUrl} already exists`);
            }
        }
        if (hookCheck.length > 0) {
            res.json(response);
            return;
        }
    } catch (error) {
        response.errors.push(error.message);
        res.json(response);
        return;
    }
    try {
        console.log(`creating webhook: ${req.body.name} ${webhookUrl}`);
        await query('INSERT INTO webhooks (name, url) VALUES (?, ?)', [req.body.name, webhookUrl]);
        webhookApi.refresh();
        response.message = `Created webhook ${req.body.name}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    console.log('sending response', response);
    res.json(response);
});

app.put('/webhooks/:id', async (req, res) => {
    //edit
    const response = {message: 'No changes made.', errors: []};
    try {
        let hookCheck = await query(format('SELECT * from webhooks WHERE id=?', [req.params.id]));
        if (hookCheck.length == 0) {
            response.errors.push(`Webhook not found`);
            res.json(response);
            return;
        }
        const WEBHOOK_BASE = 'https://discord.com/api/webhooks/';
        let webhookUrl = req.body.url.replace(WEBHOOK_BASE, '');
        const pattern = /^\d+\/[a-zA-Z0-9-_]+$/;
        if (!webhookUrl.match(pattern)) {
            response.errors.push('Not a valid webhook url');
            res.json(response);
            return;
        }
        const oldValues = hookCheck[0];
        hookCheck = await query('SELECT * from webhooks WHERE id<>? AND (name=? OR url=?)', [req.params.id, req.body.name, webhookUrl]);
        for (let i = 0; i < hookCheck.length; i++) {
            if (hookCheck[i].name === req.body.name) {
                response.errors.push(`Webhook with name ${req.body.name} already exists`);
            }
            if (hookCheck[i].url === webhookUrl) {
                response.errors.push(`Webhook with url ${webhookUrl} already exists`);
            }
        }
        if (hookCheck.length > 0) {
            res.json(response);
            return;
        }
        const updates = {};
        if (req.body.name && req.body.name !== oldValues.name) {
            updates.name = req.body.name;
        }
        if (webhookUrl !== oldValues.url) {
            updates.url = webhookUrl;
        }
        const updateFields = [];
        const updateValues = [];
        for (const field in updates) {
            updateFields.push(field);
            updateValues.push(updates[field]);
        }
        if (updateFields.length > 0) {
            await query(format(`UPDATE webhooks SET ${updateFields.map(field => {
                return `${field} = ?`;
            }).join(', ')} WHERE id='${req.params.id}'`, updateValues));
            webhookApi.refresh();
            response.message = `Updated ${updateFields.join(', ')}`;
            console.log(`Edited webhook ${req.params.id}: ${updateFields.join(', ')}`)
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.delete('/webhooks/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let deleteResult = await query(format('DELETE FROM webhooks WHERE id=?', [req.params.id]));
        if (deleteResult.affectedRows > 0) {
            console.log(`Deleted webhook ${req.params.id}`);
            response.message = `Webhook deleted`;
            webhookApi.refresh();
        } else {
            response.errors.push(`Webhook ${req.params.id} not found`);
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.get('/crons', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/ansi_up.js"></script>
        <script src="/crons.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/cronstrue/2.11.0/cronstrue.min.js"></script>
        <div class="row">
            <div class="col s12">
                <div>
                    Note: Jobs are scheduled in UTC. You local time is <span class="timeoffset"></span> hours UTC.
                </div>
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                Job
                            </th>
                            <th>
                                Schedule
                            </th>
                            <th>
                                Last Run
                            </th>
                            <th>
                                Next Run
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-view-cron-log" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4></h4>
                <div class="row">
                    <div class="log-messages s12" style="height:400px;"></div>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat">Close</a>
            </div>
        </div>
        <div id="modal-edit-cron" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4></h4>
                <div>
                    Note: Jobs are scheduled in UTC. You local time is <span class="timeoffset"></span> hours UTC.
                </div>
                <div class="row">
                    <form class="col s12 post-url" method="post" action="/crons/set">
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="schedule" type="text" class="validate schedule" name="schedule" placeholder=" ">
                                <label for="schedule">Schedule</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="cronstrue col s12">
                            </div>
                        </div>
                        <input value="" id="jobName" type="hidden" name="jobName" class="jobName">
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-cron-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat">Close</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/crons/get', async (req, res) => {
    res.json(jobs.schedules());
});

app.get('/crons/get/:name', async (req, res) => {
    try {
        const logMessages = JSON.parse(fs.readFileSync(path.join(__dirname, 'logs', req.params.name+'.log'), {encoding: 'utf8'}));
        res.json(logMessages);
        return;
    } catch (error) {
        console.log(chalk.red(`Error retrieving ${req.params.name} job log`), error);
    }
    res.json([]);
});

app.post('/crons/set', async (req, res) => {
    const response = {
        success: true,
        message: `${req.body.jobName} job updated to ${req.body.schedule}`,
        errors: []
    };
    try {
        jobs.setSchedule(req.body.jobName, req.body.schedule);
    } catch (error) {
        console.log(chalk.red(`Error setting ${req.params.jobName} job schedule`), error);
        response.success = false;
        response.message = `Error setting ${req.params.jobName} job schedule`;
        response.errors.push(error.toString());
    }
    res.json(response);
});

app.get('/crons/run/:name', async (req, res) => {
    const response = {
        success: true,
        message: `${req.params.name} job started`,
        errors: []
    };
    try {
        const startDate = new Date();
        await jobs.runJob(req.params.name);
        response.message = `${req.params.name} job finished in ${new Date - startDate} ms`;
    } catch (error) {
        console.log(chalk.red(`Error running ${req.params.name} job`), error);
        response.success = false;
        response.message = `Error running ${req.params.name} job`;
        response.errors.push(error.toString());
    }
    res.json(response);
});

app.get('/json', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/ansi_up.js"></script>
        <script src="/json.js"></script>
        <div class="row">
            <div class="col s12">
                <div>
                    <form class="col s12 post-url json-upload id" data-attribute="action" method="post" action="">
                        <span>Upload: </span><input id="json-upload" class="single-upload" type="file" name="file" />
                        <a href="#" class="waves-effect waves-light btn json-upload tooltipped" data-tooltip="Upload"><i class="material-icons">file_upload</i></a>
                    </form>
                </div>
                <div>
                    <label>
                        <input name="json-dir" type="radio" id="dir-cache" value="cache" checked />
                        <span>cache</span>
                    </label>
                    <label>
                        <input name="json-dir" type="radio" id="dir-dumps" value="dumps" />
                        <span>dumps</span>
                    </label>
                </div>
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                File
                            </th>
                            <th>
                                Size (kb)
                            </th>
                            <th>
                                Modified
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-delete-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Delete</h4>
                <div>Are you sure you want to delete <span class="modal-delete-confirm-file"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-cancel">No</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/json/:dir', async (req, res) => {
    const response = {json: [], errors: []};
    const dir = req.params.dir;
    if (!validJsonDirs.includes(dir)) {
        response.errors.push(`${dir} is not a valid JSON directory`);
        return res.json(response);
    }
    const jsonFiles = fs.readdirSync(`./${dir}`).filter(file => file.endsWith('.json'));

    for (const file of jsonFiles) {
        var stats = fs.statSync(`./${dir}/${file}`);
        response.json.push({
            name: file,
            size: stats.size,
            modified: stats.mtime,
        });
    }
    response.json = response.json.sort((a, b) => a.name.localeCompare(b.name));
    res.json(response);
});

app.get('/json/:dir/:file', async (req, res) => {
    const dir = req.params.dir;
    let file = req.params.file;
    file = file.split('/').pop();
    file = file.split('\\').pop();
    if (!validJsonDirs.includes(dir) || !file.endsWith('.json')) {
        return res.status(404).send('Not found');
    }
    try {
        const jsonFile = fs.readFileSync(`./${dir}/${file}`);
        res.send(jsonFile);
    } catch (error) {
        return res.status(404).send(error.message);
    }
});

app.delete('/json/:dir/:file', async (req, res) => {
    const dir = req.params.dir;
    let file = req.params.file;
    file = file.split('/').pop();
    file = file.split('\\').pop();
    const response = {message: `${file} deleted`, errors: []};
    if (!validJsonDirs.includes(dir) || !file.endsWith('.json')) {
        response.message = 'Error deleting '+file;
        response.errors.push(`${dir} is not a valid directory`);
        return res.json(response);
    }
    try {
        fs.unlinkSync(`./${dir}/${file}`);
        res.send(response);
    } catch (error) {
        response.message = 'Error deleting '+file;
        response.errors.push(error.message);
        return res.json(response);
    }
});

app.post('/json/:dir', async (req, res) => {
    const response = {json: [], errors: []};
    const dir = req.params.dir;
    if (!validJsonDirs.includes(dir)) {
        response.errors.push(`${dir} is not a valid JSON directory`);
        return res.json(response);
    }
    const form = formidable.formidable({
        multiples: true,
        uploadDir: path.join(__dirname, 'cache'),
    });
    const finish = (files) => {
        if (files) {
            let filesArr = files.file;
            for (const index in filesArr) {
                let file = filesArr[index];
                //console.log('removing', file.filepath);
                fs.rm(file.filepath, error => {
                    if (error) console.log(`Error deleting ${file.filepath}`, error);
                });
            }
        }
    };

    try {
        await new Promise((resolve, reject) => {
            form.parse(req, async (error, fields, files) => {
                if (error) {
                    finish(files);
                    return reject(error);
                }
                let filesArr = files.file;
                let file = filesArr[0];
                let fileName = file.originalFilename;
                fileName = fileName.split('/').pop();
                fileName = fileName.split('\\').pop();
                if (!fileName.endsWith('.json')) {
                    finish(files);
                    return reject(new Error(`File name must end in .json`));
                }
                fs.renameSync(file.filepath, `./${dir}/${fileName}`);
                delete file;
                response.message = `${fileName} uploaded`;
                resolve();
            });
        });
    } catch (error) {
        if (Array.isArray(error)) {
            for (const err of error) {
                console.log(err);
                response.errors.push(err.message);
            }
        } else {
            console.log(error);
            response.errors.push(error.message);
        }
    }
    res.json(response);
});

app.get('/s3-bucket', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/ansi_up.js"></script>
        <script src="/s3-bucket.js"></script>
        <div class="row">
            <div class="col s12">
                <div>
                    <form class="col s12 post-url file-upload id" data-attribute="action" method="post" action="">
                        <span>Path: </span><input id="file-path" class="validate path" type="text" name="path" value="" style="width: auto;"/>
                        <span>Upload: </span><input id="file-upload" class="single-upload" type="file" name="file" multiple="multiple"/>
                        <a href="#" class="waves-effect waves-light btn file-upload tooltipped" data-tooltip="Upload"><i class="material-icons">file_upload</i></a>
                    </form>
                </div>
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                File
                            </th>
                            <th>
                                Image
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-delete-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Delete</h4>
                <div>Are you sure you want to delete <span class="modal-delete-confirm-file"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-cancel">No</a>
            </div>
        </div>
        <div id="modal-rename-confirm" class="modal">
            <div class="modal-content">
                <h4>Rename <span class="filename"></span></h4>
                <div class="row">
                    <form class="col s12" method="put" action="">
                        <div class="row">
                            <div class="input-field col s12">
                                <input value="" type="text" class="validate new-file-name" name="new-file-name" placeholder=" ">
                                <label for="new-file-name">New Name</label>
                            </div>
                        </div>
                        <input type="hidden" name="old-file-name" class="old-file-name"/>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat rename-confirm">Rename</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat rename-cancel">Cancel</a>
            </div>
        </div>
        <div id="modal-copy-confirm" class="modal">
            <div class="modal-content">
                <h4>Copy <span class="filename"></span></h4>
                <div class="row">
                    <form class="col s12" method="post" action="">
                        <div class="row">
                            <div class="input-field col s12">
                                <input value="" type="text" class="validate new-file-name" name="new-file-name" placeholder=" ">
                                <label for="new-file-name">New Name</label>
                            </div>
                        </div>
                        <input type="hidden" name="old-file-name" class="old-file-name"/>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat copy-confirm">Copy</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat copy-cancel">Cancel</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/s3-bucket/get', async (req, res) => {
    const response = {json: [], errors: []};
    for (const key of getLocalBucketContents()) {
        response.json.push({
            name: key,
            link: `https://${process.env.S3_BUCKET}/${key}`,
        });
    }
    res.json(response);
});

app.delete('/s3-bucket/?*/:file', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        const fullPath = req.params[0] || ''; // Captures the entire path
        const filename = path.join(fullPath, req.params.file);
        await deleteFromBucket(filename);
        response.message = `${req.params.file} deleted from S3`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.post('/s3-bucket/?*/:file', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        const fullPath = req.params[0] || ''; // Captures the entire path
        const filename = path.join(fullPath, req.params.file);
        await copyFile(filename, req.body['new-file-name']);
        response.message = `${filename} copied to ${req.body['new-file-name']}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.put('/s3-bucket/?*/:file', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        const fullPath = req.params[0] || ''; // Captures the entire path
        const filename = path.join(fullPath, req.params.file);
        await renameFile(filename, req.body['new-file-name']);
        response.message = `${filename} renamed to ${req.body['new-file-name']}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.post('/s3-bucket', async (req, res) => {
    const response = {json: [], errors: []};
    const form = formidable.formidable({
        multiples: true,
        uploadDir: path.join(__dirname, 'cache'),
    });
    const finish = (files) => {
        if (files) {
            let filesArr = files.file;
            for (const index in filesArr) {
                let file = filesArr[index];
                console.log('removing', file.filepath);
                fs.rm(file.filepath, error => {
                    if (error) console.log(`Error deleting ${file.filepath}`, error);
                });
            }
        }
    };

    try {
        await new Promise((resolve, reject) => {
            form.parse(req, async (error, fields, files) => {
                if (error) {
                    finish(files);
                    return reject(error);
                }
                let path = fields['path'][0];
                const pathRegex = new RegExp(`^(?:[^\/]+\/)*$`);
                const match = path.match(pathRegex);
                if (!match) {
                    finish(files);
                    return reject(new Error("Invalid path"));
                }
                var names = [];
                let filesArr = files.file;
                for (const index in filesArr) {
                    let file = filesArr[index];
                    var fileName = file.originalFilename;
                    fileName = fileName.split('/').pop();
                    fileName = fileName.split('\\').pop();
                    names.push(fileName);
                    fileName = path + fileName;
                    await addFileToBucket(file.filepath, fileName);
                }
                finish(files);
                response.message = `${names.join(",")} uploaded to S3`;
                resolve();
            });
        });
    } catch (error) {
        if (Array.isArray(error)) {
            for (const err of error) {
                console.log(err);
                response.errors.push(err.message);
            }
        } else {
            console.log(error);
            response.errors.push(error.message);
        }
    }
    res.json(response);
});

app.get('/wipes', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/wipes.js"></script>
        <div class="row">
            <div class="col s12">
                <a href="#" class="waves-effect waves-light btn add-wipe tooltipped" data-tooltip="Add wipe"><i class="material-icons">add</i></a>
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                Start
                            </th>
                            <th>
                                Patch
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-edit-wipe" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4></h4>
                <div>
                    Warning: Queries use the date of the latest wipe as as a starting cutoff. Adding a new wipe can remove previous prices from the API.
                </div>
                <div class="row">
                    <form class="col s12 post-url" method="post" action="/wipes">
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="start_date" type="text" class="validate start_date" name="start_date" placeholder=" ">
                                <label for="start_date">Start Date</label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="version" type="text" class="validate version" name="version" placeholder=" ">
                                <label for="version">Version</label>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-wipe-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat">Close</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/wipes/get', async (req, res) => {
    const wipes = await query('SELECT * FROM wipe');
    res.json(wipes);
});

app.post('/wipes', async (req, res) => {
    //add
    const response = {message: 'No changes made.', errors: []};
    if (!req.body.start_date) {
        response.errors.push('Start date cannot be blank');
    }
    if (!req.body.version) {
        response.errors.push('Version cannot be blank');
    }
    if (response.errors.length > 0) {
        res.json(response);
        return;
    }
    try {
        const wipeCheck = await query('SELECT * FROM wipe WHERE start_date=? OR version=?', [req.body.start_date, req.body.version]);
        for (const wipe of wipeCheck) {
            if (wipe.start_date === req.body.start_date) {
                response.errors.push(`Wipe with start date ${req.body.start_date} already exists`);
            }
            if (wipe.version === req.body.version) {
                response.errors.push(`Wipe with version ${req.body.version} already exists`);
            }
        }
        if (wipeCheck.length > 0) {
            res.json(response);
            return;
        }
    } catch (error) {
        response.errors.push(error.message);
        res.json(response);
        return;
    }
    try {
        console.log(`creating wipe: ${req.body.start_date} ${req.body.version}`);
        const result = await query('INSERT INTO wipe (start_date, version) VALUES (?, ?)', [req.body.start_date, req.body.version]);
        let lastPriceId = 0;
        const lastPrice = await query('SELECT id FROM price_data ORDER BY id DESC LIMIT 1');
        if (lastPrice.length > 0) {
            lastPriceId = lastPrice[0].id;
        }
        await query('UPDATE wipe SET cuttoff_price_id=? WHERE id=?', [lastPriceId, result.insertId]);
        response.message = `Created wipe ${req.body.start_date} ${req.body.version}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.put('/wipes/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await query('UPDATE wipe SET start_date=?, version=? WHERE id=?', [req.body.start_date, req.body.version, req.params.id]);
        response.message = `Wipe updated to ${req.body.start_date} (${req.body.version})`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.delete('/wipes/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let deleteResult = await query('DELETE FROM wipe WHERE id=?', [req.params.id]);
        if (deleteResult.affectedRows > 0) {
            console.log(`Deleted wipe ${req.params.id}`);
            response.message = `Wipe deleted`;
        } else {
            response.errors.push(`Wipe ${req.params.id} not found`);
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.all('/api/scanner/:resource', async (req, res) => {
    scannerApi.request(req, res, req.params.resource);
});

app.post('/api/webhooks/:hooksource/:webhookid/:webhookkey', async (req, res) => {
    webhookApi.handle(req, res, req.params.hooksource, req.params.webhookid+'/'+req.params.webhookkey);
});

app.post('/api/queue', async (req, res) => {
    publicApi.queue(req, res);
});

app.post('/api/goons', async (req, res) => {
    publicApi.goons(req, res);
});

const server = app.listen(port, () => {
    console.log(`Tarkov Data Manager listening at http://localhost:${port}`)
});

(async () => {
    connection.keepAlive = true;
    jobs.start();

    const triggerShutdown = async () => {
        try {
            await new Promise(resolve => {
                server.close(error => {
                    if (error) {
                        console.log('error closing HTTP server');
                        console.log(error);
                    }
                    resolve();
                });
            });
            await jobs.stop().catch(error => {
                console.log('error stopping scheduled jobs');
                console.log(error);
            });
            await new Promise(resolve => {
                connection.end(error => {
                    if (error) {
                        console.log('error closing database connection pool');
                        console.log(error);
                    }
                    resolve();
                });
            });
            await webSocketServer.close();
        } catch (error) {
            console.log(error);
        }
        console.log('Shutdown complete');
        process.exit();
    };
    //gracefully shutdown on Ctrl+C
    process.on( 'SIGINT', triggerShutdown);
    //gracefully shutdown on Ctrl+Break
    process.on( 'SIGBREAK', triggerShutdown);
    //try to gracefully shutdown on terminal closed
    process.on( 'SIGHUP', triggerShutdown);
})();
