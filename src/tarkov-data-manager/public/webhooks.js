
const webhookTypes = [
    'rollbar',
    'test'
];

let table = false;

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();

    const columns = [
        {
            data: 'name',
            render: (data, type, webhook) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small filled edit-webhook tooltipped" data-tooltip="Edit" data-id="${webhook.id}" data-name="${data}" data-url="${webhook.url}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small tonal delete-webhook tooltipped" data-tooltip="Delete" data-id="${webhook.id}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'url',
            render: (data, type, webhook) => {
                if (type === 'display') {
                    const linkButtons = [];
                    for (let i = 0; i < webhookTypes.length; i++) {
                        linkButtons.push(`<a href="#" class="waves-effect waves-light btn-small tonal copy-link ${webhookTypes[i]} tooltipped" data-tooltip="Copy ${webhookTypes[i]} webhook url" data-url="${webhook.url}"><i class="material-icons left">link</i>${webhookTypes[i]}</a>`);
                    }
                    return `
                        <div><a href="https://discord.com/api/webhooks/${data}" target="_blank">${data}</a></div>
                        <div>
                            ${linkButtons.join('\n                            ')}
                        </div>
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
            url: '/webhooks/get',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.edit-webhook').off('click');
            $('.edit-webhook').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $('#modal-edit-webhook .name').val(target.data('name'));
                $('#modal-edit-webhook .url').val(target.data('url'));
                const form = $('#modal-edit-webhook').find('form').first();
                form.attr('action', `/webhooks/${target.data('id')}`);
                form.attr('method', 'PUT');
                M.Modal.getInstance(document.getElementById('modal-edit-webhook')).open();
                //M.updateTextFields();
                $('#modal-edit-user .username').focus();
            });

            $('.delete-webhook').off('click');
            $('.delete-webhook').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $.ajax({
                    type: "DELETE",
                    url: `/webhooks/${target.data('id')}`,
                    dataType: "json"
                }).done(function (data) {
                    M.toast({text: data.message});
                    if (data.errors.length > 0) {
                        for (let i = 0; i < data.errors.length; i++) {
                            M.toast({text: data.errors[i]});
                        }
                        return;
                    }
                    table.ajax.reload();
                });
            });

            for (let i = 0; i < webhookTypes.length; i++) {
                const hookType = webhookTypes[i];
                $(`.copy-link.${hookType}`).off('click');
                $(`.copy-link.${hookType}`).click(function(event) {
                    let target = $(event.target);
                    if (target[0].nodeName === 'I') target = target.parent();
                    navigator.clipboard.writeText(`https://${window.location.hostname}/api/webhooks/${hookType}/${target.data('url')}`);
                    M.toast({text:`${hookType} API URL copied to clipboard.`});
                });
            }
        }
    });

    $('#modal-edit-webhook .edit-webhook-save').click(function(event) {
        const form = $('#modal-edit-webhook').find('form').first();
        const formData = form.serialize();
        $.ajax({
            method: form.attr('method'),
            url: form.attr('action'),
            data: formData,
            dataType: "json"
        }).done(function (data) {
            M.toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
                return;
            }
            M.Modal.getInstance(document.getElementById('modal-edit-webhook')).close();
            table.ajax.reload();
        });
    });

    $('.btn.add-webhook').click(function(event) {
        $('#modal-edit-webhook .name').val('');
        $('#modal-edit-webhook .url').val('');
        const form = $('#modal-edit-webhook').find('form').first();
        form.attr('action', '/webhooks');
        form.attr('method', 'POST');
        M.Modal.getInstance(document.getElementById('modal-edit-webhook')).open();
        $('#modal-edit-webhook .name').focus();
    });
} );