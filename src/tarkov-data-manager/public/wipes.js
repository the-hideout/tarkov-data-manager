
let table = false;

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();
    M.AutoInit();

    const columns = [
        {
            data: 'start_date',
            render: (data, type, wipe) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small filled edit-wipe tooltipped" data-tooltip="Edit" data-id="${wipe.id}" data-start-date="${data}" data-version="${wipe.version}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small tonal delete-wipe tooltipped" data-tooltip="Delete" data-id="${wipe.id}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'version',
            render: (data, type, wipe) => {
                return data;
            }
        }
    ];

    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/wipes/get',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            try {
                M.AutoInit();
            } catch (error) {
                console.error('Error initializing materializecss', error);
            }

            $('.edit-wipe').off('click');
            $('.edit-wipe').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $('#modal-edit-wipe .start_date').val(target.data('startDate'));
                $('#modal-edit-wipe .version').val(target.data('version'));
                const form = $('#modal-edit-wipe').find('form').first();
                form.attr('action', `/wipes/${target.data('id')}`);
                form.attr('method', 'PUT');
                M.Modal.getInstance(document.getElementById('modal-edit-wipe')).open();
                //M.updateTextFields();
                $('#modal-edit-wipe .start_date').focus();
            });

            $('.delete-wipe').off('click');
            $('.delete-wipe').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $.ajax({
                    type: "DELETE",
                    url: `/wipes/${target.data('id')}`,
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
        }
    });

    $('#modal-edit-wipe .edit-wipe-save').click(function(event) {
        const form = $('#modal-edit-wipe').find('form').first();
        const formData = form.serialize();
        console.log(formData)
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
            M.Modal.getInstance(document.getElementById('modal-edit-wipe')).close();
            table.ajax.reload();
        });
    });

    $('.btn.add-wipe').click(function(event) {
        $('#modal-edit-wipe .start_date').val('');
        $('#modal-edit-wipe .version').val('');
        const form = $('#modal-edit-wipe').find('form').first();
        form.attr('action', '/wipes');
        form.attr('method', 'POST');
        M.Modal.getInstance(document.getElementById('modal-edit-wipe')).open();
        $('#modal-edit-wipe .start_date').focus();
    });
} );