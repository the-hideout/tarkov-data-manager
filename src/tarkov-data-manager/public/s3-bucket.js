let table = false;

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();
    M.AutoInit();

    const columns = [
        {
            data: 'name',
            render: (data, type, row) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small delete-file tooltipped" data-tooltip="Delete" data-file="${data}"><i class="material-icons">delete</i></a>
                            <a href="#" class="waves-effect waves-light btn-small rename-file tooltipped" data-tooltip="Rename" data-file="${data}"><i class="material-icons">text_fields</i></a>
                            <a href="#" class="waves-effect waves-light btn-small copy-file tooltipped" data-tooltip="Copy" data-file="${data}"><i class="material-icons">file_copy</i></a>
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
                if (data.match(/\.(?:jpg|png|webp|svg)$/)) {
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
            try {
                M.AutoInit();
            } catch (error) {
                console.error('Error initializing materializecss', error);
            }

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

            $('.rename-file').off('click');
            $('.rename-file').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const fileName = target.data('file');
                $('#modal-rename-confirm h4 .filename').text(fileName);
                $('#modal-rename-confirm input.old-file-name').val(fileName);
                $('#modal-rename-confirm input.new-file-name').val(fileName);
                $('#modal-rename-confirm .rename-confirm').data('file', fileName);
                M.Modal.getInstance(document.getElementById('modal-rename-confirm')).open();
                $('#modal-rename-confirm input.new-file-name').focus();
            });

            $('.copy-file').off('click');
            $('.copy-file').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                const fileName = target.data('file');
                $('#modal-copy-confirm h4 .filename').text(fileName);
                $('#modal-copy-confirm input.old-file-name').val(fileName);
                $('#modal-copy-confirm input.new-file-name').val(fileName);
                $('#modal-copy-confirm .copy-confirm').data('file', fileName);
                M.Modal.getInstance(document.getElementById('modal-copy-confirm')).open();
                $('#modal-copy-confirm input.new-file-name').focus();
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
            M.toast({text: data.message});
            $('.delete-file').each((index, el) => {
                if (el.dataset.file === fileName) {
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
        const fileName = $('#modal-delete-confirm .delete-confirm').data('file');
        $('.delete-file').each((index, el) => {
            if (el.dataset.file === fileName) {
                $(el).removeClass('disabled');
            }
        });
    });

    $('#modal-rename-confirm .rename-confirm').click(event => {
        const fileName = $('#modal-rename-confirm .rename-confirm').data('file');
        const form = $('#modal-rename-confirm').find('form').first();
        const formData = form.serialize();
        $.ajax({
            method: 'PUT',
            dataType: "json",
            url: `/s3-bucket/${fileName}`,
            data: formData,
        }).done(function (data) {
            M.toast({text: data.message});
            $('.rename-file').each((index, el) => {
                if (el.dataset.file === fileName) {
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

    $('#modal-rename-confirm .rename-cancel').click(event => {
        const fileName = $('#modal-rename-confirm .rename-confirm').data('file');
        $('.rename-file').each((index, el) => {
            if (el.dataset.file === fileName) {
                $(el).removeClass('disabled');
            }
        });
    });

    $('#modal-copy-confirm .copy-confirm').click(event => {
        const fileName = $('#modal-copy-confirm .copy-confirm').data('file');
        const form = $('#modal-copy-confirm').find('form').first();
        const formData = form.serialize();
        $.ajax({
            method: 'POST',
            dataType: "json",
            url: `/s3-bucket/${fileName}`,
            data: formData,
        }).done(function (data) {
            M.toast({text: data.message});
            $('.copy-file').each((index, el) => {
                if (el.dataset.file === fileName) {
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

    $('#modal-copy-confirm .copy-cancel').click(event => {
        const fileName = $('#modal-copy-confirm .copy-confirm').data('file');
        $('.copy-file').each((index, el) => {
            if (el.dataset.file === fileName) {
                $(el).removeClass('disabled');
            }
        });
    });

    $('a.file-upload').click(function(event){
        const form = $('form.file-upload').first();
        const formData = new FormData(form[0]);
        if (!formData.has('file') || formData.get('file').size === 0) {
            M.toast({text: 'You must select a file to upload'});
            return;
        }
        fetch('/s3-bucket', {
            method: 'POST',
            body: formData
        }).then(response => response.json()).then(data => {
            M.toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({text: data.errors[i]});
                }
            }
            $('#file-upload').val('');
            table.ajax.reload();
        }).catch(error => {
            M.toast({text: error});
        });
    });
} );