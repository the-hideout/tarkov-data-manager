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

const tableData = [];

$(document).ready( function () {
    let table = false;
    const showTable = () => {
        if (table) table.destroy();
        table = $('table.main').DataTable({
            pageLength: 25,
            columnDefs: [
                {
                    searchable: false,
                    targets: 4,
                },
            ],
        });
    };
    showTable();
    $('table.main').css('display', '');
    showTable();
    $('.dataTables_length select').addClass('browser-default');

    $('.collapsible').collapsible();
    $('.tooltipped').tooltip();
    $('.dropdown-trigger').dropdown();
    $('.modal').modal();

    $('.guess-wiki-link').click(function(event){
        let itemName = encodeURIComponent($(event.target).data('itemName').replace(/ /g, '_'));
        $('#wiki-link').val(`https://escapefromtarkov.fandom.com/wiki/${itemName}`);
    });

    $('.scanner-dropdown').click(function(event){
        event.stopPropagation();
    });

    $('a.shutdown-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        $('#modal-shutdown-confirm .modal-shutdown-confirm-scanner-name').text(scannerName);
        $('#modal-shutdown-confirm .shutdown-confirm').data('scannerName', scannerName);
        const shutdownModal = M.Modal.getInstance(document.getElementById('modal-shutdown-confirm'));
        shutdownModal.open();
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
} );