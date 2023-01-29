let table = false;

$(document).ready( function () {
    $('.tooltipped').tooltip();
    $('.modal').modal();

    const columns = [
        {
            data: 'name',
            render: (data, type, jsonFile) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="/json/${$('input[name="json-dir"]:checked').val()}/${data}" class="waves-effect waves-light btn download-json tooltipped" data-tooltip="Download" data-file="${data}"><i class="material-icons">file_download</i></a>
                            <a href="#" class="waves-effect waves-light btn delete-json tooltipped" data-tooltip="Delete" data-file="${data}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'size',
            render: (data, type, jsonFile) => {
                if (type !== 'display') {
                    return data;
                }
                return Math.round(data / 1000).toLocaleString();
            }
        },
        {
            data: 'modified',
            render: (data, type, jsonFile) => {
                if (type === 'display') {
                    if (!data) return 'N/A';
                    const date = new Date(data);
                    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                }
                return data;
            }
        },
    ];
    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/json/'+$('input[name="json-dir"]:checked').val(),
            dataSrc: 'json'
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();
            $('.delete-json').off('click');
            $('.delete-json').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const fileName = target.data('file');
                const dir = $('input[name="json-dir"]:checked').val();
                $('#modal-delete-confirm .modal-delete-confirm-file').text(fileName);
                $('#modal-delete-confirm .delete-confirm').data('file', fileName);
                M.Modal.getInstance(document.getElementById('modal-delete-confirm')).open();
            });
        }
    });

    $('input[name="json-dir"]').change(event => {
        table.ajax.url('/json/'+$('input[name="json-dir"]:checked').val());
        table.ajax.reload();
    });

    $('#modal-delete-confirm .delete-confirm').click(event => {
        const dir = $('input[name="json-dir"]:checked').val();
        const fileName = $('#modal-delete-confirm .delete-confirm').data('file');
        $.ajax({
            method: 'DELETE',
            dataType: "json",
            url: `/json/${dir}/${fileName}`
        }).done(function (data) {
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
                return;
            }
            //target.removeClass('disabled');
            table.ajax.reload();
        });
    });

    $('#modal-delete-confirm .delete-cancel').click(event => {
        const fileName = $('#modal-delete-confirm .delete-confirm').data('file');
        $('.delete-json').each(function(index) {
            const element = $(this);
            if (element.data('file') === fileName) {
                element.removeClass('disabled');
            }
        });
    });

    $('a.btn.json-upload').click(function(event){
        const form = $('form.json-upload').first();
        const formData = new FormData(form[0]);
        if (!formData.has('file') || formData.get('file').size === 0) {
            M.toast({html: 'You must select a json file to upload'});
            return;
        }
        fetch('/json/'+$('input[name="json-dir"]:checked').val(), {
            method: 'POST',
            body: formData
        }).then(response => response.json()).then(data => {
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
            }
            $('#json-upload').val('');
            table.ajax.reload();
        });
    });
} );