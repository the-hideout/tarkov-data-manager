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

getScannerValue = (sessionID, settingName) => {
    return wsClients[sessionID].send(JSON.stringify({
        sessionID: sessionID,
        type: 'getValue',
        data: {name: settingName}
    }));
};

function startListener(channel) {
    //const WEBSOCKET_SERVER = 'wss://tarkov-tools-live.herokuapp.com';
    const WEBSOCKET_SERVER = 'ws://localhost:8080';
    let logMessages = [];

    const ws = new WebSocket(WEBSOCKET_SERVER);
    ws.sessionID = channel;
    ws.settings = {};

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

        const ansi_up = new AnsiUp;

        if(message.type === 'ping'){
            heartbeat();

            ws.send(JSON.stringify({type: 'pong'}));

            return true;
        } else if (message.type === 'command') {
            return;
        } else if (message.type === 'scannerValue') {
            console.log(`Setting scanner values for ${ws.sessionID}`);
            console.log(message);
            ws.settings[message.data.name] = message.data.value;
        } else if (message.type === 'scannerValues') {
            console.log(`Setting scanner values for ${ws.sessionID}`);
            console.log(message.data);
            ws.settings = {
                ...ws.settings,
                ...message.data
            };
            let openScanner = decodeURIComponent($('#modal-click .click-confirm').data('scannerName'));
            if (openScanner == channel) {
                $('#modal-click .scanner-last-screenshot').attr('src', ws.settings.lastScreenshot);
            }
            return;
        } else if (message.type === 'logHistory' && logMessages.length < 2) {
            logMessages = [];
            for (let i = 0; i < message.data.length; i++) {
                logMessages.push(ansi_up.ansi_to_html(message.data[i]))
            }
        }

        if (message.type !== 'logHistory') {
            const html = ansi_up.ansi_to_html(message.data);
            logMessages.push(html);
        }
        
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

$(document).ready( function () {
    $('.collapsible').collapsible();
    $('.tooltipped').tooltip();
    $('.dropdown-trigger.scanner-dropdown').dropdown({constrainWidth: false});
    $('.modal').modal();
    $('select').formSelect();

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

    $('a.screenshot-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'screenshot');
    });

    $('a.click-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        $('#modal-click .scanner-click-name').text(scannerName);
        $('#modal-click .click-x').val('');
        $('#modal-click .click-y').val('');
        $('#modal-click .scanner-last-screenshot').attr('src', '');
        if (wsClients[scannerName] && wsClients[scannerName].settings.lastScreenshot) {
            $('#modal-click .scanner-last-screenshot').attr('src', wsClients[scannerName].settings.lastScreenshot);
        }
        $('#modal-click .click-confirm').data('scannerName', scannerName);
        M.Modal.getInstance(document.getElementById('modal-click')).open();
    });

    $('#modal-click .btn.refresh-screenshot').click(function(event){
        let scannerName = $('#modal-click .scanner-click-name').text();
        sendCommand(scannerName, 'screenshot');
    });

    $('#modal-click .scanner-last-screenshot').click(function(event) {
        const img = $(this);
        const parentOffset = img.parent().offset(); 
        const relX = event.pageX - parentOffset.left;
        const relY = event.pageY - parentOffset.top;

        const scaleX = this.width / this.naturalWidth;
        const scaleY = this.height / this.naturalHeight;

        $('#modal-click .click-x').val(Math.round(relX / scaleX));
        $('#modal-click .click-y').val(Math.round(relY / scaleY));
        M.updateTextFields();
    });

    $('#modal-click .click-confirm').click(function(event){
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        const x = $('#modal-click input.click-x').val();
        const y = $('#modal-click input.click-y').val();
        sendCommand(scannerName, {clickX: x, clickY: y});
    });

    $('a.log-repeat-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'repeat-log');
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