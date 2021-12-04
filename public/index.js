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

function startListener(channel) {
    const WEBSOCKET_SERVER = 'wss://tarkov-tools-live.herokuapp.com';
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
                ws.terminate();
            }
        }, 10000 + 1000);
    };

    ws.onopen = () => {
        heartbeat();

        console.log(`Listening for messages from ${channel}`);

        ws.send(JSON.stringify({
            sessionID: channel,
            type: 'connect',
        }));
    };

    ws.onmessage = (rawMessage) => {
        const message = JSON.parse(rawMessage.data);

        if(message.type === 'ping'){
            heartbeat();

            ws.send(JSON.stringify({type: 'pong'}));

            return true;
        }

        const ansi_up = new AnsiUp;

        const html = ansi_up.ansi_to_html(message.data);

        logMessages.push(html);

        logMessages = logMessages.slice(-100);

        const wrapper = document.querySelector(`.log-messages-${channel}`)

        wrapper.innerHTML = logMessages.join('<br>');

        wrapper.scrollTop = wrapper.scrollHeight;
        // console.log(message.data);
    };
}

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

$(document).ready( function () {
    $('table').DataTable({
        pageLength: 25,
        columnDefs: [
            {
                searchable: false,
                targets: 4,
            },
        ],
    });

    $('.collapsible').collapsible();
    $('.tooltipped').tooltip();
} );