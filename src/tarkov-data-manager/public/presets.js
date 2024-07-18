let table = false;

const existingImageElement = (itemId, imageType, url) => {
    const tooltipId = `${itemId}-${imageType}-tooltip-content`;
    return `
        <a href="${url}" class="tooltipped" data-html="true" data-tooltip-id="${tooltipId}">✔️</a>
        <div id="${tooltipId}" style="display: none;">
            <div>${imageType} image</div>
            <img src="${url}" style="max-height: 300px" loading="lazy" />
        </div>
    `;
};

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();
    M.AutoInit();

    const columns = [
        {
            data: 'id',
            render: (data, type, preset) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small edit-preset tooltipped" data-tooltip="Edit" data-id="${preset.id}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small delete-preset tooltipped" data-tooltip="Delete" data-id="${preset.id}" data-name="${preset.name}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'name',
            render: (data, type, wipe) => {
                return data;
            }
        },
        {
            data: 'image_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    let imageLink = item.image_512_link;
                    if (!imageLink) {
                        imageLink = item.base_image_link || item.grid_image_link || item.icon_link;
                    }
                    return `
                        <div class="row">
                            ${imageLink ? `<div class="col s12"><img src="${imageLink}" loading="lazy" style="max-height: 200px" /></div>`: ''}
                        </div>
                        <div class="">
                            ${item.image_8x_link ? existingImageElement(item.id, '8x', item.image_8x_link): missingImageElement('8x')}
                            ${item.image_512_link ? existingImageElement(item.id, '512', item.image_512_link): missingImageElement('512')}
                            ${data ? existingImageElement(item.id, 'inspect', data): missingImageElement('inspect')}
                            ${item.base_image_link ? existingImageElement(item.id, 'base', item.base_image_link): missingImageElement('base')}
                            ${item.grid_image_link ? existingImageElement(item.id, 'grid', item.grid_image_link): missingImageElement('grid')}
                            ${item.icon_link ? existingImageElement(item.id, 'icon', item.icon_link) : missingImageElement('icon')}
                        </div>
                        <div class="row">
                            ${item.image_8x_link || item.base_image_link ? `<a class="waves-effect waves-light regenerate btn-small tooltipped" data-id="${item.id}" data-tooltip="Regenerate images from source"><i class="material-icons">refresh</i></a>` : ''}
                            <a class="waves-effect waves-light refresh-images btn-small tooltipped" data-id="${item.id}" data-tooltip="Refresh images from game"><i class="material-icons">sync</i></a>
                        </div>
                    `;
                }
                return data;
            },
            className: 'image-column',
            width: '10%',
        },
    ];

    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/presets/get',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.edit-preset').off('click');
            $('.edit-preset').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                const preset = table.rows().data().toArray().find(p => p.id === target.data('id'));
                $('#modal-edit-preset h4').text(preset.id);
                $('#modal-edit-preset h5').text(preset.name);
                $('#modal-edit-preset h6').text(preset.shortName);
                $('#modal-edit-preset .append_name').val(preset.append_name);
                const buttonsDiv = $('#modal-edit-preset .short-name-buttons');
                buttonsDiv.empty();
                const baseItem = preset.itemNames[0];
                for (const item of preset.itemNames) {
                    if (item.id === baseItem.id || item.shortName.startsWith(baseItem.shortName)) {
                        continue;
                    }
                    const nameButton = document.createElement('a');
                    nameButton.attributes.href = '#!';
                    nameButton.classList.add('btn', 'waves-effect', 'waves-green');
                    nameButton.innerText = item.shortName;
                    nameButton.onclick = () => {
                        const key = `${item.id} ShortName`;
                        $('#modal-edit-preset .append_name').val(key);
                        $('#modal-edit-preset h5').text(`${baseItem.name} ${item.shortName}`);
                        $('#modal-edit-preset h6').text(`${baseItem.shortName} ${item.shortName}`);
                    };
                    const colDiv = document.createElement('div');
                    colDiv.classList.add('preset-name-button', 'col', 's4', 'm3', 'l2');
                    colDiv.append(nameButton);
                    buttonsDiv.append(colDiv);
                }
                //$('#modal-edit-preset .version').val(target.data('version'));
                const form = $('#modal-edit-preset').find('form').first();
                form.attr('action', `/presets/${target.data('id')}`);
                form.attr('method', 'PUT');
                M.Modal.getInstance(document.getElementById('modal-edit-preset')).open();
                //M.updateTextFields();
                //$('#modal-edit-preset .start_date').focus();
            });

            $('.delete-preset').off('click');
            $('.delete-preset').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const presetName = target.data('name');
                $('#modal-delete-confirm .modal-delete-confirm-preset-name').text(presetName);
                $('#modal-delete-confirm .delete-confirm').data('id', target.data('id'));
                M.Modal.getInstance(document.getElementById('modal-delete-confirm')).open();
            });

            $('.btn-small.regenerate').off('click');
            $('.btn-small.regenerate').click(event => {
                let target = event.target;
                if (target.nodeName !== 'A') {
                    target = target.parentElement;
                }
                $(target).addClass('disabled');
                fetch(`/items/regenerate-images/${$(target).data('id')}`, {method: 'POST'}).then(response => response.json()).then(data => {
                    $(target).removeClass('disabled');
                    M.toast({text: data.message});
                    for (const error of data.errors) {
                        M.toast({text: error});
                    }
                });
            });

            $('.btn-small.refresh-images').off('click');
            $('.btn-small.refresh-images').click(event => {
                let target = event.target;
                if (target.nodeName !== 'A') {
                    target = target.parentElement;
                }
                $(target).addClass('disabled');
                fetch(`/items/refresh-images/${$(target).data('id')}`, {method: 'POST'}).then(response => response.json()).then(data => {
                    $(target).removeClass('disabled');
                    M.toast({text: data.message});
                    for (const error of data.errors) {
                        M.toast({text: error});
                    }
                });
            });
        }
    });

    $('#modal-delete-confirm .delete-confirm').click(event => {
        const presetId = $('#modal-delete-confirm .delete-confirm').data('id');
        $.ajax({
            method: 'DELETE',
            dataType: 'json',
            url: `/presets/${presetId}`
        }).done(function (data) {
            M.toast({text: data.message});
            $('.delete-preset').each((index, el) => {
                if (el.dataset.id === presetId) {
                    $(el).removeClass('disabled');
                }
            });
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
                return;
            }
            table.ajax.reload();
        });
    });

    $('#modal-delete-confirm .delete-cancel').click(event => {
        const presetId = $('#modal-delete-confirm .delete-confirm').data('id');
        $('.delete-preset').each((index, el) => {
            if (el.dataset.id === presetId) {
                $(el).removeClass('disabled');
            }
        });
    });

    $('#modal-edit-preset .edit-preset-save').click(function(event) {
        const form = $('#modal-edit-preset').find('form').first();
        const formData = form.serialize();
        $.ajax({
            method: form.attr('method'),
            url: form.attr('action'),
            data: formData,
            dataType: 'json'
        }).done(function (data) {
            M.toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
                return;
            }
            M.Modal.getInstance(document.getElementById('modal-edit-preset')).close();
            table.ajax.reload();
        });
    });

    /*$('.btn.add-preset').click(function(event) {
        //$('#modal-edit-preset .start_date').val('');
        //$('#modal-edit-preset .version').val('');
        const form = $('#modal-edit-preset').find('form').first();
        form.attr('action', '/preset');
        form.attr('method', 'POST');
        M.Modal.getInstance(document.getElementById('modal-edit-preset')).open();
        //$('#modal-edit-preset .start_date').focus();
    });*/
} );