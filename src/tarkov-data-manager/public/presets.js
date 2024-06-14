let table = false;

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
        }
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
                form.attr('action', `/preset/${target.data('id')}`);
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
        console.log(formData)
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