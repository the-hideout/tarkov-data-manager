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
    const WEBSOCKET_SERVER = 'wss://socket.tarkov.dev';
    //const WEBSOCKET_SERVER = 'ws://localhost:8080';
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
            ws.settings[message.data.name] = message.data.value;
        } else if (message.type === 'scannerValues') {
            console.log(`Setting scanner values for ${ws.sessionID}`);
            ws.settings = {
                ...ws.settings,
                ...message.data
            };
            let openScanner = decodeURIComponent($('#modal-click .do-click').first().data('scannerName'));
            if (openScanner == channel) {
                $('#modal-click .scanner-last-screenshot').attr('src', ws.settings.lastScreenshot);
            }
            return;
        } else if (message.type === 'logHistory' && logMessages.length < 2) {
            logMessages = [];
            for (let i = 0; i < message.data.length; i++) {
                logMessages.push(ansi_up.ansi_to_html(message.data[i]));
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

let table = false;

$(document).ready( function () {
    M.Collapsible.init($('.collapsible'));
    M.Tooltip.init($('.tooltipped'));
    M.Dropdown.init($('.dropdown-trigger.scanner-dropdown'), {constrainWidth: false});
    M.Modal.init($('.modal'));
    M.FormSelect.init($('select'));
    M.Tabs.init($('.tabs')[0]);

    /*document.querySelectorAll('.scanner-dropdown').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log(el);
        }, {capture: true});
    });*/

    $('.scanner-dropdown').click(function(event){
        event.stopPropagation();
    });

    $('a.restart-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        $('#modal-restart-confirm .modal-restart-confirm-scanner-name').text(scannerName);
        $('#modal-restart-confirm .restart-confirm').data('scannerName', scannerName);
        M.Modal.getInstance(document.getElementById('modal-restart-confirm')).open();
    });

    $('#modal-restart-confirm .restart-confirm').click(function(event){
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'restart');
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
        $('#modal-click .do-click').data('scannerName', scannerName);
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
        //M.updateTextFields();
    });

    $('#modal-click .do-click').click(function(event){
        let scannerName = decodeURIComponent($(event.target).data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        const x = $('#modal-click input.click-x').val();
        const y = $('#modal-click input.click-y').val();
        sendCommand(scannerName, {clickX: x, clickY: y});
    });

    $('a.update-scanner').click(function(event){
        event.stopPropagation();
        let scannerName = decodeURIComponent($(event.target).closest('li').data('scannerName'));
        if (!wsClients[scannerName]) {
            return;
        }
        sendCommand(scannerName, 'update');
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
            M.toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
            }
          });
        M.Modal.getInstance(document.getElementById('modal-edit-item')).close();
    });

    const columns = [
        {
            data: 'username',
            render: (data, type, user) => {
                if (type === 'display') {
                    return `
                        <div>${data}</div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small edit-user tooltipped" data-tooltip="Edit" data-username="${data}" data-password="${user.password}" data-id="${user.id}" data-max_scanners="${user.max_scanners}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small delete-user tooltipped" data-tooltip="Delete" data-username="${data}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'password',
            render: (data, type, user) => {
                if (type === 'display') {
                    return `
                        <div>
                            <div class="password-holder hidden">${data.replace(/./g, '*')}</div>
                            <div>
                                <a href="#" class="waves-effect waves-light btn-small show-password tooltipped" data-tooltip="Show" data-password="${data}"><i class="material-icons">remove_red_eye</i></a>
                                <a href="#" class="waves-effect waves-light btn-small copy-password tooltipped" data-tooltip="Copy" data-password="${data}"><i class="material-icons">content_copy</i></a>
                            </div>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'scanners',
            render: (data, type, user) => {
                if (type === 'display') {
                    const scannerDivs = [];
                    for (const scanner of data) {
                        scannerDivs.push(`<div><a href="#" class="waves-effect waves-light tooltipped edit-scanner" data-tooltip="Edit ${scanner.name}" data-id="${scanner.id}" data-flags="${scanner.flags}">${scanner.name}</a></div>`);
                        //scannerDivs.push(`<div>${scanner.name}</div>`);
                    }
                    return `
                        <div>
                            ${scannerDivs.join('\n                            ')}
                        </div>
                    `;
                }
                return data.map(scanner => {
                    return scanner.id+'_'+scanner.name;
                }).join(',');
            }
        },
        {
            data: 'flags',
            render: (data, type, user) => {
                if (type === 'display') {
                    let markupString = '<div class="row">';
                    for(const flagName in userFlags){
                        if (flagName === 'disabled') continue;
                        const flagValue = userFlags[flagName];
                        const flagLabel = flagName.replace(/[A-Z]/g, capLetter => {
                            return ' '+capLetter.toLowerCase();
                        });
                        markupString = `${markupString}
                        <div class="col s12 l6 xl4 xxl3">
                            <label for="${user.id}-${[flagName]}">
                                <input type="checkbox" class="user-flag" id="${user.id}-${[flagName]}" value="${flagValue}" data-id="${user.id}" ${data & flagValue ? 'checked' : ''} />
                                <span>${flagLabel}</span>
                            </label>
                        </div>`;
                    }
                    return `${markupString}</div>`;
                }
                return data;
            }
        },
        {
            data: 'disabled',
            render: (data, type, user) => {
                if (type === 'display') {
                    return `
                    <label for="${user.id}-disabled">
                        <input type="checkbox" class="user-disabled" id="${user.id}-disabled" value="1" data-id="${user.id}" ${data ? 'checked' : ''} />
                        <span></span>
                    </label>
                    `;
                }
                return data;
            }
        }
    ];

    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/scanners/get-users',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.edit-user').off('click');
            $('.edit-user').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $('#modal-edit-user .username').val(target.data('username'));
                $('#modal-edit-user .user_id').val(target.data('id'));
                $('#modal-edit-user .password').val(target.data('password'));
                $('#modal-edit-user .max_scanners').val(target.data('max_scanners'));
                $('#modal-edit-user .user_disabled').prop('checked', target.closest('tr').find('.user-disabled').first().prop('checked'));
                const form = $('#modal-edit-user').find('form').first();
                form.attr('action', '/scanners/edit-user');
                M.Modal.getInstance(document.getElementById('modal-edit-user')).open();
                //M.updateTextFields();
                $('#modal-edit-user .username').focus();
            });

            $('.delete-user').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                postData('/scanners/delete-user', {username: target.data('username')}).then(data => {
                    if (data.errors.length > 0) {
                        for (let i = 0; i < data.errors.length; i++) {
                            M.toast({text: data.errors[i]});
                        }
                        return;
                    }
                    table.ajax.reload();
                });
            });

            $('input.user-disabled').off('change');
            $('input.user-disabled').change((event) => {
                if(event.target.getAttribute('type') !== 'checkbox'){
                    return true;
                }
            
                const dataUpdate = {
                    user_id: event.target.dataset.id,
                    user_disabled: event.target.checked,
                }
            
                postData('/scanners/edit-user', dataUpdate).then(data => {
                    if (data.errors.length > 0) {
                        for (let i = 0; i < data.errors.length; i++) {
                            M.toast({text: data.errors[i]});
                        }
                        return;
                    }
                });
            });

            $('.show-password').off('click');
            $('.show-password').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                const pw = target.data('password');
                const holder = target.parent().parent().find('.password-holder').first();
                if (holder.hasClass('hidden')) {
                    holder.text(pw);
                    holder.removeClass('hidden');
                } else {
                    holder.text(pw.replace(/./g, '*'));
                    holder.addClass('hidden');
                }
            });

            $('.copy-password').off('click');
            $('.copy-password').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                const pw = target.data('password');
                navigator.clipboard.writeText(pw);
            });

            $('.edit-scanner').off('click');
            $('.edit-scanner').click(function (event) {
                let target = $(event.target);
                //if (target[0].nodeName === 'I') target = target.parent();
                const flagChecks = $('#modal-edit-scanner input.scanner-flag');
                const scannerFlags = parseInt(target.data('flags'));
                for (const check of flagChecks) {
                    checkValue = parseInt(check.value);
                    $(check).prop('checked', scannerFlags & checkValue);
                }
                const id = $(event.target).data('id');
                $('#modal-edit-scanner input.scanner-flag').off('change');
                $('#modal-edit-scanner input.scanner-flag').change((changedEvent) => {
                    if(changedEvent.target.getAttribute('type') !== 'checkbox'){
                        return true;
                    }
                    const checkedFlags = $(changedEvent.target).closest('form').find('input.scanner-flag:checked');
                    let flags = 0;
                    for (const check of checkedFlags) {
                        flags |= Number($(check).val());
                    }
                
                    const dataUpdate = {
                        id: id,
                        flags: flags
                    }
                
                    postData('/scanners/scanner-flags', dataUpdate).then(data => {
                        if (data.errors.length > 0) {
                            for (let i = 0; i < data.errors.length; i++) {
                                M.toast({text: data.errors[i]});
                            }
                        }
                    });
                });
                $('#modal-edit-scanner .scanner-name').text(target.text());
                M.Modal.getInstance(document.getElementById('modal-edit-scanner')).open();
            });

            $('input.user-flag').off('change');
            $('input.user-flag').change((event) => {
                if(event.target.getAttribute('type') !== 'checkbox'){
                    return true;
                }
                const checkedFlags = $(event.target).closest('td').find('input.user-flag:checked');
                let flags = 0;
                for (const check of checkedFlags) {
                    flags |= Number($(check).val());
                }
            
                const id = $(event.target).data('id');
                const dataUpdate = {
                    id: id,
                    flags: flags
                }
            
                postData('/scanners/user-flags', dataUpdate).then(data => {
                    if (data.errors.length > 0) {
                        for (let i = 0; i < data.errors.length; i++) {
                            M.toast({text: data.errors[i]});
                        }
                    }
                });
            });
        }
    });

    $('#modal-edit-user .edit-user-save').click(function(event) {
        const form = $('#modal-edit-user').find('form').first();
        const formData = form.serialize();
        $.ajax({
            type: "POST",
            url: form.attr('action'),
            data: formData,
            dataType: "json"
        }).done(function (data) {
            M.toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
            } else {
                M.Modal.getInstance(document.getElementById('modal-edit-user')).close();
                table.ajax.reload();
            }
        });
    });

    $('.btn.add-user').click(function(event) {
        $('#modal-edit-user .username').val('');
        $('#modal-edit-user .password').val('');
        $('#modal-edit-user .user_disabled').prop('checked', false);
        const form = $('#modal-edit-user').find('form').first();
        form.attr('action', '/scanners/add-user');
        M.Modal.getInstance(document.getElementById('modal-edit-user')).open();
        $('#modal-edit-user .username').focus();
    });
} );
