let table = false;

$(document).ready( function () {
    $('.tooltipped').tooltip();
    $('.modal').modal();

    const columns = [
        {
            data: 'name',
            render: (data, type, row) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn delete-file tooltipped" data-tooltip="Delete" data-file="${data}"><i class="material-icons">delete</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'link',
            render: (data, type, row) => {
                if (type !== 'display') {
                    return data;
                }
                if (data.match(/\.(?:jpg|png|webp)$/)) {
                    return `<img src="${data}" loading="lazy" style="max-height: 200px" />`;
                }
                return `<a href="${data}" target="_blank">${data}</a>`;
            }
        },
    ];

    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/s3-bucket/get',
            dataSrc: 'json'
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.delete-file').off('click');
            $('.delete-file').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const fileName = target.data('file');
                $('#modal-delete-confirm .modal-delete-confirm-file').text(fileName);
                $('#modal-delete-confirm .delete-confirm').data('file', fileName);
                M.Modal.getInstance(document.getElementById('modal-delete-confirm')).open();
            });
        }
    });

    $('#modal-delete-confirm .delete-confirm').click(event => {
        const fileName = $('#modal-delete-confirm .delete-confirm').data('file');
        $.ajax({
            method: 'DELETE',
            dataType: "json",
            url: `/s3-bucket/${fileName}`
        }).done(function (data) {
            M.toast({html: data.message});
            $('.delete-file').each((index, el) => {
                if (el.dataset.file === fileName) {
                    $(el).removeClass('disabled');
                }
            });
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
                return;
            }
            table.ajax.reload();
        });
    });

    $('#modal-delete-confirm .delete-cancel').click(event => {
        const fileName = $('#modal-delete-confirm .delete-confirm').data('file');
        $('.delete-file').each((index, el) => {
            if (el.dataset.file === fileName) {
                $(el).removeClass('disabled');
            }
        });
    });

    $('a.btn.file-upload').click(function(event){
        const form = $('form.file-upload').first();
        const formData = new FormData(form[0]);
        if (!formData.has('file') || formData.get('file').size === 0) {
            M.toast({html: 'You must select a file to upload'});
            return;
        }
        fetch('/s3-bucket', {
            method: 'POST',
            body: formData
        }).then(response => response.json()).then(data => {
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
            }
            $('#file-upload').val('');
            table.ajax.reload();
        });
    });
} );