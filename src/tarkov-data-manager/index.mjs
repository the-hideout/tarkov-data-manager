import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import express from 'express';
import bodyParser from 'body-parser';
import session from 'cookie-session';
import chalk from 'chalk';
import formidable from 'formidable';
import AdmZip from 'adm-zip';
import { DateTime } from 'luxon';

import './modules/configure-env.mjs';
import remoteData from './modules/remote-data.mjs';
import tarkovData from './modules/tarkov-data.mjs';
import jobs from './jobs/index.mjs';
import dbConnection from './modules/db-connection.mjs';
import scannerApi from './modules/scanner-api.mjs';
import scannerHttpApi from './modules/scanner-http-api.mjs';
import webhookApi from './modules/webhook-api.mjs';
import publicApi from './modules/public-api.mjs';
import { uploadToS3, getImages, getLocalBucketContents, addFileToBucket, deleteFromBucket, renameFile, copyFile } from './modules/upload-s3.mjs';
import { createAndUploadFromSource, regenerateFromExisting } from './modules/image-create.mjs';
import webSocketServer from './modules/websocket-server.mjs';
import jobManager from './jobs/index.mjs';
import presetData from './modules/preset-data.mjs';
import tarkovDevData from './modules/tarkov-data-tarkov-dev.mjs';

vm.runInThisContext(fs.readFileSync(import.meta.dirname + '/public/common.js'));

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
app.use(express.json({limit: '100mb'}), express.raw({type: 'image/*', limit: '50mb'}));
app.use(express.urlencoded({extended: true}));
app.use(maybe((req, res, next) => {
    if (req.session.loggedin && req.session.sessionversion === '2') {
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
                            new M.Toast({text: data.message});
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
    fs.mkdirSync(path.join(import.meta.dirname, 'cache'));
} catch (createError){
    if(createError.code !== 'EEXIST'){
        console.error(createError);
    }
}

try {
    fs.mkdirSync(path.join(import.meta.dirname, 'dumps'));
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
        if (Object.hasOwn(users, username) && users[username] === password) {
            req.session.loggedin = true;
            req.session.username = username;
            req.session.sessionversion = '2';
            response.success = true;
            response.message = 'Login successful!';
        }
    }
    res.send(response);
});

const getHeader = (req, options) => {
    const jsLibrary = {
        datatables: 'https://cdn.datatables.net/2.1.8/js/dataTables.js',
    };
    const cssLibrary = {
        datatables: 'https://cdn.datatables.net/2.1.8/css/dataTables.dataTables.css',
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
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@materializecss/materialize@2.1.1/dist/css/materialize.min.css">${includeCss}

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
                <div class="nav-wrapper blue">
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
                        <li class="${req.url === '/presets' ? 'active' : ''}"><a href="/presets">Presets</a></li>
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
                <li class="${req.url === '/wipes' ? 'active' : ''}"><a href="/wipes">Wipes</a></li>
                <li class="${req.url === '/presets' ? 'active' : ''}"><a href="/presets">Presets</a></li>
                <!--li class="${req.url === '/trader-prices' ? 'active' : ''}"><a href="/trader-prices">Trader Prices</a></li-->
            </ul>
            <div class="container">
        `;
}

const getFooter = (req) => {
    let toastJs = '';
    if (req.query.toast) {
        toastJs = `new M.Toast({text: '${decodeToast(req.query.toast)}'});`;
    }
    return `
            </div>
            <footer class="page-footer"></footer>
            <script src="https://cdn.jsdelivr.net/npm/@materializecss/materialize@2.1.1/dist/js/materialize.min.js"></script>
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
    const activeScanners = webSocketServer.connectedScanners();
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
                <a href="/scanners" class="waves-effect waves-light btn filled"><i class="material-icons left">scanner</i>Scanners</a>
                <ul class="browser-default">
                    <li>Active: ${activeScanners.length}</li>
                </ul>
            </div>
            <div class="divider col s12"></div>
            <div class="section col s12">
                <a href="/items" class="waves-effect waves-light btn filled"><i class="material-icons left">search</i>Items</a>
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

app.post('/items/refresh-images/:id', async (req, res) => {
    const response = {success: false, message: 'Error refreshing images', errors: []};
    try {
        const items = await remoteData.get();
        const item = items.get(req.params.id);
        if (!item) {
            throw new Error(`Item ${req.params.id} not found`);
        }
        let newImage;
        if (item.types.includes('preset')) {
            newImage = await tarkovDevData.fenceFetchImage('/preset-image', {
                method: 'POST',
                body: JSON.stringify({
                    id: item.id,
                    items: item.properties.items,
                }),
            });
        } else if (item.types.includes('replica')) {
            newImage = await tarkovDevData.fenceFetchImage(`/item-image/${item.properties.source}`);
        } else {
            newImage = await tarkovDevData.fenceFetchImage(`/item-image/${item.id}`);
        }
        
        await createAndUploadFromSource(newImage, item.id);
        response.message = `Refreshed ${item.id} images from EFT`;
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
    const form = formidable({
        multiples: true,
        allowEmptyFiles: true,
        minFileSize: 0,
        uploadDir: path.join(import.meta.dirname, 'cache'),
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
            <label for="type-${type}" class="no-wrap">
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
        <div>
            <ul class="collapsible">
                <li>
                    <div class="collapsible-header"><i class="material-icons">filter_list</i>Item&nbsp;Filters</div>
                    <div class="collapsible-body">
                        <div>Item Types</div>
                        <div>
                            <a class="waves-effect waves-light btn tonal filter-types-all"><i class="material-icons left">all_inclusive</i>All</a>
                            <a class="waves-effect waves-light btn tonal filter-types-none"><i class="material-icons left">not_interested</i>None</a>
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
                            <a class="waves-effect waves-light btn tonal filter-special-all"><i class="material-icons left">all_inclusive</i>All</a>
                            <a class="waves-effect waves-light btn tonal filter-special-none"><i class="material-icons left">not_interested</i>None</a>
                        </div>
                        <div class="row">${specFilters}</div>
                    </div>
                </li>
            </ul>
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
    //const t = timer('getting-items');
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
    //t.end();
    res.json(items);
});

app.get('/scanners', async (req, res) => {
    let scannerFlagsString = '';
    for (const flagName in scannerApi.scannerFlags) {
        const flagValue = scannerApi.scannerFlags[flagName];
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
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script>
            const WS_PASSWORD = '${process.env.WS_PASSWORD}';
            const userFlags = ${JSON.stringify(scannerApi.userFlags)};
        </script>
        <script src="/ansi_up.js"></script>
        <script src="/scanners.js"></script>
        <div class="row">
            <div class="col s12">
                <ul class="tabs">
                    <li class="tab col s4"><a href="#activescanners" class="active">Active Scanners</a></li>
                    <li class="tab col s4"><a href="#scannerusers">Scanner Users</a></li>
                </ul>
            </div>
            <div id="activescanners" class="col s12">
                <div class="scanners-wrapper row">
                </div>
            </div>
            <div id="scannerusers" class="col s12">
                <div class="scanner-userss-wrapper">
                    <a href="#" class="waves-effect waves-light btn filled add-user tooltipped" data-tooltip="Add API user"><i class="material-icons">person_add</i></a>
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
    const results = await Promise.all([dbConnection.query(`SELECT * FROM scanner_user`), dbConnection.query(`SELECT * FROM scanner`)]);
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
        const userCheck = await scannerApi.getUserByName(req.body.username);
        if (userCheck) {
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
        await scannerApi.addUser(req.body.username, req.body.password, user_disabled);
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
        const id = req.body.user_id;
        const userCheck = await scannerApi.getUser(id);
        if (!userCheck) {
            response.errors.push(`User not found`);
            res.send(response);
            return;
        }
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
        await scannerApi.editUser(userCheck.id, updates);
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.post('/scanners/delete-user', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let deleted = await scannerApi.deleteUser(req.body.username);
        if (deleted) {
            response.message = `User ${req.body.username} deleted`;
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
        await scannerApi.setUserFlags(req.body.id, req.body.flags);
        response.message = `Set flags to ${req.body.flags}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.post('/scanners/scanner-flags', urlencodedParser, async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await scannerApi.setScannerFlags(req.body.id, req.body.flags);
        response.message = `Set flags to ${req.body.flags}`;
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
                <a href="#" class="waves-effect waves-light btn filled add-webhook tooltipped" data-tooltip="Add webhook"><i class="material-icons">add</i></a>
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
    const webhooks = await dbConnection.query('SELECT * FROM webhooks');
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
        const hookCheck = await dbConnection.query('SELECT * FROM webhooks WHERE name=? OR url=?', [req.body.name, webhookUrl]);
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
        await dbConnection.query('INSERT INTO webhooks (name, url) VALUES (?, ?)', [req.body.name, webhookUrl]);
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
        let hookCheck = await dbConnection.query('SELECT * from webhooks WHERE id=?', [req.params.id]);
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
        hookCheck = await dbConnection.query('SELECT * from webhooks WHERE id<>? AND (name=? OR url=?)', [req.params.id, req.body.name, webhookUrl]);
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
            await dbConnection.query(`UPDATE webhooks SET ${updateFields.map(field => {
                return `${field} = ?`;
            }).join(', ')} WHERE id=?`, updateValues, req.params.id);
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
        let deleteResult = await dbConnection.query('DELETE FROM webhooks WHERE id=?', [req.params.id]);
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
    const runningJobs = jobs.schedules().filter(j => j.running);
    let runningJobsDiv = '';
    if (runningJobs.length > 0) {
        runningJobsDiv = `
            <div>
                <div>Jobs currently running:</div>
                <ul>
                    ${runningJobs.map(j => `<li>${j.name}: Started ${DateTime.fromJSDate(j.startDate).toRelative()}</li>`).join('\n')}
                </ul>
            </div>
        `;
    }
    let connectionsDiv = '';
    const usedConnections = dbConnection.connectionsInUse();
    if (usedConnections > 0) {
        connectionsDiv = `
            <div>DB connections in use: ${usedConnections}</div>
        `;
    }
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/ansi_up.js"></script>
        <script src="/crons.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/cronstrue/2.11.0/cronstrue.min.js"></script>
        <div class="row">
            <div class="col s12">
                <div>
                    Note: Jobs are scheduled in UTC. Your local time is <span class="timeoffset"></span> hours UTC.
                </div>
                ${runningJobsDiv}
                ${connectionsDiv}
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
                    Note: Jobs are scheduled in UTC. Your local time is <span class="timeoffset"></span> hours UTC.
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
        const logMessages = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'logs', req.params.name+'.log'), {encoding: 'utf8'}));
        res.json(logMessages);
        return;
    } catch (error) {
        console.log(chalk.red(`Error retrieving ${req.params.name} job log`), error);
    }
    res.json([]);
});

app.get('/crons/get-current/:name', async (req, res) => {
    try {
        let logMessages = jobManager.currentLog(req.params.name);
        if (logMessages) {
            return res.json(logMessages);
        }
        logMessages = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'logs', req.params.name+'.log'), {encoding: 'utf8'}));
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

app.get('/crons/stop/:name', async (req, res) => {
    const response = {
        success: true,
        message: `${req.params.name} job stopped`,
        errors: []
    };
    try {
        const startDate = new Date();
        await jobs.abortJob(req.params.name);
        response.message = `${req.params.name} job stopped after ${new Date - startDate} ms`;
    } catch (error) {
        console.log(chalk.red(`Error stopping ${req.params.name} job`), error);
        response.success = false;
        response.message = `Error stopping ${req.params.name} job`;
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
                        <a href="#" class="waves-effect waves-light btn filled json-upload tooltipped" data-tooltip="Upload"><i class="material-icons">file_upload</i></a>
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
    const form = formidable({
        multiples: true,
        uploadDir: path.join(import.meta.dirname, 'cache'),
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
                files.file = files.file.filter(f => f !== file);
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
                        <a href="#" class="waves-effect waves-light btn filled file-upload tooltipped" data-tooltip="Upload"><i class="material-icons">file_upload</i></a>
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

app.delete('/s3-bucket{/*splat}/:file', async (req, res) => {
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

app.post('/s3-bucket{/*splat}/:file', async (req, res) => {
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

app.put('/s3-bucket{/*splat}/:file', async (req, res) => {
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
    const form = formidable({
        multiples: true,
        uploadDir: path.join(import.meta.dirname, 'cache'),
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
                <a href="#" class="waves-effect waves-light btn filled add-wipe tooltipped" data-tooltip="Add wipe"><i class="material-icons">add</i></a>
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
    const wipes = await dbConnection.query('SELECT * FROM wipe');
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
        const wipeCheck = await dbConnection.query('SELECT * FROM wipe WHERE start_date=? OR version=?', [req.body.start_date, req.body.version]);
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
        const result = await dbConnection.query('INSERT INTO wipe (start_date, version) VALUES (?, ?)', [req.body.start_date, req.body.version]);
        let lastPriceId = 0;
        const lastPrice = await dbConnection.query('SELECT id FROM price_data WHERE game_mode = 0 ORDER BY id DESC LIMIT 1');
        if (lastPrice.length > 0) {
            lastPriceId = lastPrice[0].id;
        }
        await dbConnection.query('UPDATE wipe SET cuttoff_price_id=? WHERE id=?', [lastPriceId, result.insertId]);
        response.message = `Created wipe ${req.body.start_date} ${req.body.version}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.json(response);
});

app.put('/wipes/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await dbConnection.query('UPDATE wipe SET start_date=?, version=? WHERE id=?', [req.body.start_date, req.body.version, req.params.id]);
        response.message = `Wipe updated to ${req.body.start_date} (${req.body.version})`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.delete('/wipes/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        let deleteResult = await dbConnection.query('DELETE FROM wipe WHERE id=?', [req.params.id]);
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

app.get('/presets', async (req, res) => {
    res.send(`${getHeader(req, {include: 'datatables'})}
        <script src="/presets.js"></script>
        <div class="row">
            <div class="col s12">
                <!--a href="#" class="waves-effect waves-light btn filled add-preset tooltipped" data-tooltip="Add preset"><i class="material-icons">add</i></a-->
                <table class="highlight main">
                    <thead>
                        <tr>
                            <th>
                                name
                            </th>
                            <th>
                                images
                            </th>
                            <th>
                                last used
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                    </tbody>
                </table>
            </div>
        </div>
        <div id="modal-edit-preset" class="modal modal-fixed-footer">
            <div class="modal-content">
                <h4></h4>
                <h5></h5>
                <h6></h6>
                <div class="row">
                    <form class="col s12 post-url" method="patch" action="/presets">
                        <div class="row">
                            <div class="input-field s12">
                                <input value="" id="append_name" type="text" class="validate append_name" name="append_name" placeholder=" ">
                                <label for="append_name">Append Name</label>
                            </div>
                        </div>
                        <div class="row short-name-buttons"></div>
                    </form>
                </div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn edit-preset-save">Save</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat">Close</a>
            </div>
        </div>
        <div id="modal-merge-preset" class="modal modal-fixed-footer">
            <div class="modal-content">
                <div class="row">
                    <div class="col s4">
                        <h4>Merge Preset</h4>
                        <h5></h5>
                        <h6></h6>
                    </div>
                    <div id="merge-source-image" class="col s8"></div>
                </div>
                <div class="row"><div class="col s12"><p>This action will merge the above preset (source) into the selected preset (target). All prices for the source will be moved to the target and the source will be deleted.</p></div></div>
                <div class="row">
                    <form class="col s12 post-url" method="patch" action="/presets">
                        <div class="row">
                            <div class="input-field s12">
                                <select id="merge-target" name="merge-target"></select>
                                <label for="merge-target">Merge Into</label>
                            </div>
                        </div>
                        <div class="row short-name-buttons"></div>
                    </form>
                </div>
                <div id="merge-target-image" class="row"></div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="waves-effect waves-green btn merge-preset-save">Merge</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat">Close</a>
            </div>
        </div>
        <div id="modal-merge-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Merge</h4>
                <div>Are you sure you want to merge <span class="modal-merge-confirm-source"></span> into <span class="modal-merge-confirm-target"></span>? This cannot be undone.</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat merge-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat merge-cancel">No</a>
            </div>
        </div>
        <div id="modal-delete-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Delete</h4>
                <div>Are you sure you want to delete <span class="modal-delete-confirm-preset-name"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat delete-cancel">No</a>
            </div>
        </div>
        <div id="modal-id-change-confirm" class="modal">
            <div class="modal-content">
                <h4>Confirm Normalize ID</h4>
                <div>Are you sure you want to normalize the id for <span class="modal-change-confirm-preset-name"></span>?</div>
            </div>
            <div class="modal-footer">
                <a href="#!" class="modal-close waves-effect waves-green btn-flat change-confirm">Yes</a>
                <a href="#!" class="modal-close waves-effect waves-green btn-flat change-cancel">No</a>
            </div>
        </div>
    ${getFooter(req)}`);
});

app.get('/presets/get', async (req, res) => {
    const [presets, en, items] = await Promise.all([
        dbConnection.query('SELECT * FROM manual_preset'),
        tarkovData.locale('en'),
        remoteData.get(),
    ]);
    for (const preset of presets) {
        const baseItemId = preset.items[0]._tpl;
        const append = en[preset.append_name] ?? preset.append_name;
        preset.name = `${en[`${baseItemId} Name`]} ${append}`;
        preset.shortName = `${en[`${baseItemId} ShortName`]} ${append}`;
        preset.itemNames = preset.items.map(item => {
            return {
                id: item._tpl,
                name: en[`${item._tpl} Name`],
                shortName: en[`${item._tpl} ShortName`],
            };
        });
        preset.image_8x_link = items.get(preset.id)?.image_8x_link;
        preset.image_512_link = items.get(preset.id)?.image_512_link;
        preset.image_link = items.get(preset.id)?.image_link ?? null;
        preset.base_image_link = items.get(preset.id)?.base_image_link;
        preset.grid_image_link = items.get(preset.id)?.grid_image_link;
        preset.icon_link = items.get(preset.id)?.icon_link;
    }
    res.json(presets);
});

app.get('/presets/get/game', async (req, res) => {
    const [gamePresets, en, items] = await Promise.all([
        presetData.getGamePresets(),
        tarkovData.locale('en'),
        remoteData.get(),
    ]);
    const presets = [];
    for (const presetId in items.keys()) {
        if (!gamePresets[presetId]) {
            continue;
        }
        const p = items.get(presetId);
        if (!p) {
            continue;
        }
        const preset = {
            id: p.id,
            name: p.name,
            shortName: p.short_name,
            items: p.properties.items,
            itemNames: p.properties.items.map(item => {
                return {
                    id: item._tpl,
                    name: en[`${item._tpl} Name`],
                    shortName: en[`${item._tpl} ShortName`],
                };
            }),
            image_8x_link: p.image_8x_link,
            image_512_link: p.image_512_link,
            image_link: p.image_link,
            base_image_link: p.base_image_link,
            grid_image_link: p.grid_image_link,
            icon_link: p.icon_link,
        };
        presets.push(preset);
    }
    res.json(presets);
});

app.patch('/presets/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        const preset = await dbConnection.query('SELECT * FROM manual_preset WHERE id = ?', [req.params.id]).then(results => results[0]);
        if (preset.append_name !== req.body.append_name) {
            await dbConnection.query('UPDATE manual_preset SET append_name = ? WHERE id = ?', [req.body.append_name, req.params.id]);
            const [en, items] = await Promise.all([tarkovData.locale('en'), remoteData.get()]);
            const baseItem = items.get(preset.items[0]._tpl);
            await remoteData.setProperties(req.params.id, {
                name: `${baseItem.name} ${en[req.body.append_name]}`,
                short_name: `${baseItem.short_name} ${en[req.body.append_name]}`,
            });
            response.message = 'Preset updated';
            try {
                await regenerateFromExisting(req.params.id);
            } catch (error) {
                console.log(error);
                if (Array.isArray(error)) {
                    response.errors = error.map(err => err.message || err);
                } else {
                    response.errors.push(error.message || error);
                }
            }
        }
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.put('/presets/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await presetData.mergePreset(req.params.id, req.body.id);
        response.message = `Preset ${req.params.id} merged into ${req.body.id}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.delete('/presets/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        await presetData.deletePreset(req.params.id);
        response.message = `Preset ${req.params.id} deleted`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.get('/presets/normalize-id/:id', async (req, res) => {
    const response = {message: 'No changes made.', errors: []};
    try {
        //await presetData.deletePreset(req.params.id);
        if (req.params.id.startsWith('707265736574')) {
            throw new Error(`Preset id ${req.params.id} is already normalized`);
        }
        const presets = remoteData.getPresets();
        const preset = presets[req.params.id];
        if (!preset) {
            throw new Error(`Preset ${req.params.id} not found`);
        }
        const newId = await presetData.getNextPresetId();
        await presetData.changePresetId(req.params.id, newId);
        response.message = `Preset ${req.params.id} changed to ${newId}`;
    } catch (error) {
        response.errors.push(error.message);
    }
    res.send(response);
});

app.all('/api/scanner/:resource', async (req, res) => {
    scannerHttpApi.request(req, res, req.params.resource);
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
            await dbConnection.end().catch(error => {
                console.log('error closing database connection pool');
                console.log(error);
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
