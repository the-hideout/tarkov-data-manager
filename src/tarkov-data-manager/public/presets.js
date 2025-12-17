let table = false;

let gamePresets = [];

const normalidPrefix = '707265736574';

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

const missingImageElement = (imageType) => {
    return `<span class="tooltipped" style="cursor: default" data-tooltip="${imageType} image">🚫</span>`;
};

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();
    M.AutoInit();

    $.ajax({
        method: 'get',
        dataType: 'json',
        url: '/presets/get/game',
    }).done((data) => {
        gamePresets = data;
    });

    const columns = [
        {
            data: 'name',
            render: (data, type, preset) => {
                if (type === 'display') {
                    let changeIdButton = '';
                    if (!preset.id.startsWith(normalidPrefix)) {
                        changeIdButton = `<a href="#" class="waves-effect waves-light btn-small tonal change-id-preset tooltipped" data-tooltip="Normalize id" data-id="${preset.id}" data-name="${preset.name}"><i class="material-icons">qr_code</i></a>`;
                    }
                    return `
                        <div><b>${data}</b></div>
                        <div>${preset.id}</div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small tonal edit-preset tooltipped" data-tooltip="Edit" data-id="${preset.id}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small tonal merge-preset tooltipped" data-tooltip="Merge" data-id="${preset.id}"><i class="material-icons">merge</i></a>
                            <a href="#" class="waves-effect waves-light btn-small tonal delete-preset tooltipped" data-tooltip="Delete" data-id="${preset.id}" data-name="${preset.name}"><i class="material-icons">delete</i></a>
                            ${changeIdButton}
                        </div>
                    `;
                }
                return data+preset.id;
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
                            ${item.image_8x_link || item.base_image_link ? `<a class="waves-effect waves-light regenerate btn-small tonal tooltipped" data-id="${item.id}" data-tooltip="Regenerate images from source"><i class="material-icons">refresh</i></a>` : ''}
                            <a class="waves-effect waves-light refresh-images btn-small tonal tooltipped" data-id="${item.id}" data-tooltip="Refresh images from game"><i class="material-icons">sync</i></a>
                        </div>
                    `;
                }
                return data;
            },
            className: 'image-column',
            width: '10%',
        },
        {
            data: 'last_used',
            render: (data, type, preset) => {
                if (type === 'display') {
                    return new Date(data).toLocaleString();
                }
                return data;
            }
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
            try {
                M.AutoInit($('table.main.dataTable tbody')[0]);
            } catch (error) {
                console.error('Error initializing materializecss', error);
            }

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
                form.attr('method', 'PATCH');
                M.Modal.getInstance(document.getElementById('modal-edit-preset')).open();
                //M.updateTextFields();
                //$('#modal-edit-preset .start_date').focus();
            });

            $('.merge-preset').off('click');
            $('.merge-preset').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                const preset = table.rows().data().toArray().find(p => p.id === target.data('id'));
                const baseItemId = preset.items[0]._tpl;
                const select = $('#merge-target')[0];
                select.innerHTML = '';
                const allPresets = [...table.rows().data().toArray(), ...gamePresets];
                allPresets.forEach(p => {
                    if (p.items[0]._tpl !== baseItemId) {
                        return;
                    }
                    if (p.id === preset.id) {
                        return;
                    }
                    const option = document.createElement('option');
                    option.value = p.id;
                    option.innerText = `${p.id} ${p.shortName}`;
                    select.appendChild(option);
                });
                M.FormSelect.init(document.querySelectorAll('#merge-target'));
                $('#modal-merge-preset h5').text(preset.shortName);
                $('#modal-merge-preset h6').text(preset.id);
                $('#modal-merge-preset .append_name').val(preset.append_name);
                const image = document.createElement('img');
                image.src = preset.image_512_link;
                image.style = 'max-height: 100px; max-width: 500px';
                $('#merge-source-image').empty();
                $('#merge-source-image').append(image);
                $('#merge-target-image').empty();
                select.dispatchEvent(new Event('change'));
                const form = $('#modal-merge-preset').find('form').first();
                form.attr('action', `/presets/${preset.id}`);
                form.attr('method', 'PUT');
                M.Modal.getInstance(document.getElementById('modal-merge-preset')).open();
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

            $('.change-id-preset').off('click');
            $('.change-id-preset').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const presetName = target.data('name');
                $('#modal-id-change-confirm .modal-change-confirm-preset-name').text(presetName);
                $('#modal-id-change-confirm .change-confirm').data('id', target.data('id'));
                M.Modal.getInstance(document.getElementById('modal-id-change-confirm')).open();
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
                    new M.Toast({text: data.message});
                    for (const error of data.errors) {
                        new M.Toast({text: error});
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
                    new M.Toast({text: data.message});
                    for (const error of data.errors) {
                        new M.Toast({text: error});
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
            new M.Toast({text: data.message});
            $('.delete-preset').each((index, el) => {
                if (el.dataset.id === presetId) {
                    $(el).removeClass('disabled');
                }
            });
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    new M.Toast({text: data.errors[i]});
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
            new M.Toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    new M.Toast({text: data.errors[i]});
                }
                return;
            }
            M.Modal.getInstance(document.getElementById('modal-edit-preset')).close();
            table.ajax.reload();
        });
    });

    $('#modal-merge-preset .merge-preset-save').click(function(event) {
        M.Modal.getInstance(document.getElementById('modal-merge-preset')).close();
        const sourceId = $('#modal-merge-preset h6').first().text();
        const targetId = $('#modal-merge-preset').find('select').first().val();
        $('#modal-merge-confirm .modal-merge-confirm-source').text(sourceId);
        $('#modal-merge-confirm .modal-merge-confirm-target').text(targetId);
        M.Modal.getInstance(document.getElementById('modal-merge-confirm')).open();
    });

    $('.merge-confirm').click(function (event) {
        const form = $('#modal-merge-preset').find('form').first();
        const targetId = $('#modal-merge-preset').find('select').first().val();
        $.ajax({
            method: form.attr('method'),
            url: form.attr('action'),
            data: {id: targetId},
            dataType: 'json'
        }).done(function (data) {
            new M.Toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    new M.Toast({text: data.errors[i]});
                }
                return;
            }
            M.Modal.getInstance(document.getElementById('modal-merge-confirm')).close();
            table.ajax.reload();
        });
    });

    $('#modal-id-change-confirm .change-confirm').click(event => {
        const presetId = $('#modal-id-change-confirm .change-confirm').data('id');
        $.ajax({
            method: 'GET',
            dataType: 'json',
            url: `/presets/normalize-id/${presetId}`
        }).done(function (data) {
            new M.Toast({text: data.message});
            $('.change-id-preset').each((index, el) => {
                if (el.dataset.id === presetId) {
                    $(el).removeClass('disabled');
                }
            });
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    new M.Toast({text: data.errors[i]});
                }
                return;
            }
            table.ajax.reload();
        });
    });

    $('#modal-id-change-confirm .change-cancel').click(event => {
        const presetId = $('#modal-id-change-confirm .change-confirm').data('id');
        $('.change-id-preset').each((index, el) => {
            if (el.dataset.id === presetId) {
                $(el).removeClass('disabled');
            }
        });
    });

    document.getElementById('merge-target').addEventListener('change', function(e) {
        const preset = table.rows().data().toArray().find(p => p.id === this.value) ?? gamePresets.find(p => p.id === this.value);
        if (!preset) {
            return;
        }
        const image = document.createElement('img');
        image.src = preset.image_512_link;
        image.style = 'max-height: 100px; max-width: 250px';
        $('#merge-target-image').empty();
        $('#merge-target-image').append(image);
    });

    M.FormSelect.init($('select'));

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