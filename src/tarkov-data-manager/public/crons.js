let table = false;

$(document).ready( function () {
    //$('.tooltipped').tooltip();
    //$('.modal').modal();

    const columns = [
        {
            data: 'name',
            render: (data, type, cron) => {
                if (type === 'display') {
                    return `
                        <div><b>${data}</b></div>
                        <div>
                            <a href="#" class="waves-effect waves-light btn-small edit-cron tooltipped" data-tooltip="Edit" data-job="${data}" data-schedule="${cron.schedule}"><i class="material-icons">edit</i></a>
                            <a href="#" class="waves-effect waves-light btn-small run-cron tooltipped" data-tooltip="Run" data-job="${data}"><i class="material-icons">play_arrow</i></a>
                        </div>
                    `;
                }
                return data;
            }
        },
        {
            data: 'schedule',
            render: (data, type, cron) => {
                if (type !== 'display') {
                    return data;
                }
                let tooltipText = '';
                if (data) {
                    tooltipText = data.includes(' ') ? window.cronstrue.toString(data) : `On event ${data}`;
                }
                return `<span class="tooltipped" data-tooltip="${tooltipText}">${data}</span>`
            }
        },
        {
            data: 'lastRun',
            render: (data, type, cron) => {
                if (type === 'display') {
                    if (!data) return 'N/A';
                    const date = new Date(data);
                    return `<a href="#" class="view-cron-log" data-cron="${cron.name}">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</a>`;
                }
                return data;
            }
        },
        {
            data: 'nextRun',
            render: (data, type) => {
                if (type === 'display') {
                    if (!data) return 'N/A';
                    const date = new Date(data);
                    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
                }
                return data;
            }
        }
    ];

    table = $('table.main').DataTable({
        pageLength: 50,
        order: [[0, 'asc']],
        ajax: {
            url: '/crons/get',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.edit-cron').off('click');
            $('.edit-cron').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                $('#modal-edit-cron h4').html(target.data('job'));
                $('#modal-edit-cron .jobName').val(target.data('job'));
                $('#modal-edit-cron .schedule').val(target.data('schedule'));
                M.Modal.getInstance(document.getElementById('modal-edit-cron')).open();
                //M.updateTextFields();
                $('#modal-edit-cron .schedule').keyup();
                $('#modal-edit-cron .schedule').focus();
            });

            $('.run-cron').off('click');
            $('.run-cron').click(function (event) {
                let target = $(event.target);
                if (target[0].nodeName === 'I') target = target.parent();
                target.addClass('disabled');
                M.toast({text: `Starting ${target.data('job')} job...`});
                $.ajax({
                    //method: ,
                    dataType: "json",
                    url: '/crons/run/'+target.data('job')
                }).done(function (data) {
                    M.toast({text: data.message});
                    if (data.errors.length > 0) {
                        for (let i = 0; i < data.errors.length; i++) {
                            M.toast({text: data.errors[i]});
                        }
                        return;
                    }
                    target.removeClass('disabled');
                    table.ajax.reload();
                });
            });

            $('.view-cron-log').off('click');
            $('.view-cron-log').click(function (event) {
                let target = $(event.target);
                $('#modal-view-cron-log .log-messages').empty().html('Loading...');
                $('#modal-view-cron-log h4').text(target.data('cron'));
                M.Modal.getInstance(document.getElementById('modal-view-cron-log')).open();
                $.ajax({
                    //method: ,
                    dataType: "json",
                    url: '/crons/get/'+target.data('cron')
                }).done(function (data) {
                    const ansi_up = new AnsiUp;
                    const logMessages = [];
                    for (let i = 0; i < data.length; i++) {
                        logMessages.push(ansi_up.ansi_to_html(data[i]));
                    }
                    $('#modal-view-cron-log .log-messages').html(logMessages.join('<br>'));
                });
            });
        }
    });

    $('#schedule').keyup(event => {
        const input = $(event.target);
        try {
            $('#modal-edit-cron .cronstrue').text(window.cronstrue.toString(input.val()));
        } catch (error) {
            if (input.val().includes(' ')) {
                console.log(error);
            }
            $('#modal-edit-cron .cronstrue').text('');
        }
    });

    $('#modal-edit-cron .edit-cron-save').click(function(event) {
        const form = $('#modal-edit-cron').find('form').first();
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
            M.Modal.getInstance(document.getElementById('modal-edit-cron')).close();
            table.ajax.reload();
        });
    });

    const offset = new Date().getTimezoneOffset()*-1;
    let sign = '';
    if (offset >= 0) sign = '+';
    $('.timeoffset').text(`${sign}${offset/60}`);
} );