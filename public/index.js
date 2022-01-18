
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

const wsClients = {};

const sendMessage = (sessionID, type, data) => {
    wsClients[sessionID].send(JSON.stringify({
        sessionID: sessionID,
        type: type,
        data: data
    }));
};

const sendCommand = (sessionID, command) => {
    wsClients[sessionID].send(JSON.stringify({
        sessionID: sessionID,
        type: 'command',
        data: command,
        password: WS_PASSWORD
    }));
}

function startListener(channel) {
    const WEBSOCKET_SERVER = 'wss://tarkov-tools-live.herokuapp.com';
    //const WEBSOCKET_SERVER = 'ws://localhost:8080';
    let logMessages = [];

    const ws = new WebSocket(WEBSOCKET_SERVER);

    const heartbeat = function heartbeat() {
        clearTimeout(ws.pingTimeout);

        // Use `WebSocket#terminate()`, which immediately destroys the connection,
        // instead of `WebSocket#close()`, which waits for the close timer.
        // Delay should be equal to the interval at which your server
        // sends out pings plus a conservative assumption of the latency.
        ws.pingTimeout = setTimeout(() => {
            if(ws?.terminate){
                console.log(`terminating ${ws.sessionID}`);
                ws.terminate();
            }
        }, 30000 + 35000);
    };

    ws.onopen = () => {
        heartbeat();

        console.log(`Listening for messages from ${channel}`);

        ws.send(JSON.stringify({
            sessionID: channel,
            type: 'connect',
            role: 'listener'
        }));
    };

    ws.onmessage = (rawMessage) => {
        const message = JSON.parse(rawMessage.data);

        if(message.type === 'ping'){
            heartbeat();

            ws.send(JSON.stringify({type: 'pong'}));

            return true;
        } else if (message.type === 'command') {
            return;
        }

        const ansi_up = new AnsiUp;

        const html = ansi_up.ansi_to_html(message.data);

        logMessages.push(html);

        logMessages = logMessages.slice(-100);

        const wrapper = document.querySelector(`.log-messages-${channel}`);

        const atBottom = wrapper.scrollTop + wrapper.offsetHeight > wrapper.scrollHeight;

        wrapper.innerHTML = logMessages.join('<br>');

        if (atBottom) {
            wrapper.scrollTop = wrapper.scrollHeight;
        } 
        // console.log(message.data);
    };
    wsClients[channel] = ws;
};

document.addEventListener('change', (event) => {
    if(event.target.getAttribute('type') !== 'checkbox'){
        return true;
    }

    const dataUpdate = {
        id: event.target.dataset.itemId,
        type: event.target.value,
        active: event.target.checked,
    }
    console.log(dataUpdate);
    console.log(event);

    postData('/update', dataUpdate)
        .then(data => {
            console.log(data); // JSON data parsed by `data.json()` call
        });
});

const showEditItemModal = function(event){
    let link = $(event.target);
    if (event.target.nodeName != 'A') {
        link = $(event.target.parentNode);
    }
    const item = JSON.parse(decodeURIComponent(link.data('item')));
    const editModal = $('#modal-edit-item');
    for (const field in item) {
        editModal.find(`.item-content-${field}`).text(item[field]);
        editModal.find(`.item-value-${field}`).val(item[field]);
        editModal.find(`.item-attribute-${field}`).each(function(){
            const attributeName = $(this).data('attribute');
            let value = item[field];
            if ($(this).data('prependValue')) {
                value = $(this).data('prependValue')+value;
            }
            $(this).attr(attributeName, value);
        });
        editModal.find(`.item-image-${field}`).each(function(){
            $(this).empty();
            if (!item[field]) {
                return;
            }
            $(this).append(`<img src="${item[field]}">`)
        });
    }
    M.Modal.getInstance(document.getElementById('modal-edit-item')).open();
    M.updateTextFields();
};

$(document).ready( function () {
    let table = false;
    const columns = [
        {
            data: 'name',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `
                        <div>
                            ${data}
                        </div>
                        <div>
                            ${item.id}
                        </div>
                        <div>
                            <a href="${item.wiki_link}">Wiki</a>
                            |
                            <a href="https://tarkov-tools.com/item/${item.normalized_name}">Tarkov Tools</a>
                            <br>
                            <a class="waves-effect waves-light btn edit-item" data-item="${encodeURIComponent(JSON.stringify(item))}"><i class="material-icons">edit</i></a>
                        </div>
                    `;
                }
                return data;
            },
            className: 'name-column'
        },
        {
            data: 'image_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'icon_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'grid_image_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'types',
            render: (data, type, item) => {
                if (type === 'display') {
                    let markupString = '';
                    for(const type of AVAILABLE_TYPES){
                        markupString = `${markupString}
                        <div class="type-wrapper">
                            <label for="${item.id}-${type}">
                                <input type="checkbox" id="${item.id}-${type}" value="${type}" data-item-id="${item.id}" ${data.includes(type) ? 'checked' : ''} />
                                <span>${type}</span>
                            </label>
                        </div>`;
                    }
                    return markupString;
                }
                return data.join(',');
            },
            className: 'types-column'
        },
        {
            data: 'avg24hPrice',
            render: (data, type, item) => {
                if (type === 'display') {
                    return formatPrice(data)
                }
                return data;
            }
        }
    ]
    const showTable = () => {
        if (table) table.destroy();
        table = $('table.main').DataTable({
            pageLength: 25,
            order: [[0, 'asc']],
            data: all_items,
            columns: columns,
            drawCallback: (settings) => {
                M.AutoInit();
            }
        });
    };
    showTable();
    //$('table.main').css('display', '');
    $('table.main').DataTable().on('draw', function() {
        $('.edit-item').off('click');
        $('.edit-item').click(showEditItemModal);
    });
    if (table) {
        table.draw();
    }

    $('.collapsible').collapsible();
    $('.tooltipped').tooltip();
    $('.dropdown-trigger.scanner-dropdown').dropdown({constrainWidth: false});
    $('.modal').modal();
    $('select').formSelect();

    $('.guess-wiki-link').click(function(event){
        let itemName = encodeURIComponent(decodeURIComponent($(event.target).data('itemName')).replace(/ /g, '_'));
        console.log(itemName);
        $('#wiki-link').val(`https://escapefromtarkov.fandom.com/wiki/${itemName}`);
    });

    $('.scanner-dropdown').click(function(event){
        event.stopPropagation();
    });

    $('a.shutdown-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        $('#modal-shutdown-confirm .modal-shutdown-confirm-scanner-name').text(scannerName);
        $('#modal-shutdown-confirm .shutdown-confirm').data('scannerName', scannerName);
        M.Modal.getInstance(document.getElementById('modal-shutdown-confirm')).open();
    });

    $('#modal-shutdown-confirm .shutdown-confirm').click(function(event){
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'shutdown');
    });

    $('a.pause-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'pause');
        $(event.target).closest('li').css('display', 'none');
        $(event.target).closest('ul').find('li.resume-scanner').css('display', '');
    });

    $('a.resume-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'resume');
        $(event.target).closest('li').css('display', 'none');
        $(event.target).closest('ul').find('li.pause-scanner').css('display', '');
    });

    $('a.generate-images-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'generate-images');
    });

    $('a.set-trader-scan-day').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        $('#modal-trader-scan-day .modal-trader-scan-day-scanner-name').text(scannerName);
        $('#modal-trader-scan-day .trader-scan-day-confirm').data('scannerName', scannerName);
        M.Modal.getInstance(document.getElementById('modal-trader-scan-day')).open();
    });

    $('#modal-trader-scan-day .trader-scan-day-confirm').click(function(event){
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        const scanDay = $('#modal-trader-scan-day select').val();
        sendCommand(scannerName, {setting: 'TRADER_SCAN_DAY', value: scanDay});
    });

    $('a.edit-item-save').click(function(event){
        const form = $('#modal-edit-item').find('form').first();
        const formData = form.serialize();
        $.ajax({
            type: "POST",
            url: form.attr('action'),
            data: formData,
            dataType: "json"
          }).done(function (data) {
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
            }
          });
        M.Modal.getInstance(document.getElementById('modal-edit-item')).close();
    });
} );