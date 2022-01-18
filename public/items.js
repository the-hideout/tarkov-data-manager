async function postData(url = '', data = {}) {
    // Default options are marked with *
    const response = await fetch(url, {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, *cors, same-origin
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      credentials: 'same-origin', // include, *same-origin, omit
      headers: {
        'Content-Type': 'application/json'
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: 'follow', // manual, *follow, error
      referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify(data) // body data type must match "Content-Type" header
    });

    return response.json(); // parses JSON response into native JavaScript objects
}

const showEditItemModal = function(event){
    let link = $(event.target);
    if (event.target.nodeName != 'A') {
        link = $(event.target.parentNode);
    }
    const item = JSON.parse(decodeURIComponent(link.data('item')));
    const editModal = $('#modal-edit-item');
    for (const field in item) {
        editModal.find(`.item-content-${field}`).text(item[field]);
        editModal.find(`.item-value-${field}`).val(item[field]);
        editModal.find(`.item-attribute-${field}`).each(function(){
            const attributeName = $(this).data('attribute');
            let value = item[field];
            if ($(this).data('prependValue')) {
                value = $(this).data('prependValue')+value;
            }
            $(this).attr(attributeName, value);
        });
        editModal.find(`.item-image-${field}`).each(function(){
            $(this).empty();
            if (!item[field]) {
                return;
            }
            $(this).append(`<img src="${item[field]}">`)
        });
    }
    M.Modal.getInstance(document.getElementById('modal-edit-item')).open();
    M.updateTextFields();
};

let table = false;

const drawTable = () => {
    if (table) table.draw();
};

$(document).ready( function () {
    const columns = [
        {
            data: 'name',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `
                        <div>
                            ${data}
                        </div>
                        <div>
                            ${item.id}
                        </div>
                        <div>
                            <a href="${item.wiki_link}">Wiki</a>
                            |
                            <a href="https://tarkov-tools.com/item/${item.normalized_name}">Tarkov Tools</a>
                            <br>
                            <a class="waves-effect waves-light btn edit-item" data-item="${encodeURIComponent(JSON.stringify(item))}"><i class="material-icons">edit</i></a>
                        </div>
                    `;
                }
                return data;
            },
            className: 'name-column'
        },
        {
            data: 'image_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'grid_image_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'icon_link',
            render: (data, type, item) => {
                if (type === 'display') {
                    return `${data ? `<img src="${data}" loading="lazy" />`: ''}`;
                }
                return data;
            }
        },
        {
            data: 'types',
            render: (data, type, item) => {
                if (type === 'display') {
                    let markupString = '';
                    for(const type of AVAILABLE_TYPES){
                        markupString = `${markupString}
                        <div class="type-wrapper">
                            <label for="${item.id}-${type}">
                                <input type="checkbox" class="item-type" id="${item.id}-${type}" value="${type}" data-item-id="${item.id}" ${data.includes(type) ? 'checked' : ''} />
                                <span>${type}</span>
                            </label>
                        </div>`;
                    }
                    return markupString;
                }
                return data.join(',');
            },
            className: 'types-column'
        },
        {
            data: 'avg24hPrice',
            render: (data, type, item) => {
                if (type === 'display') {
                    return formatPrice(data)
                }
                return data;
            }
        }
    ]
    const showTable = () => {
        if (table) table.destroy();
        table = $('table.main').DataTable({
            pageLength: 25,
            order: [[0, 'asc']],
            data: all_items || [],
            columns: columns,
            drawCallback: (settings) => {
                M.AutoInit();
            }
        });
    };
    showTable();
    //$('table.main').css('display', '');
    $('table.main').DataTable().on('draw', function() {
        $('.edit-item').off('click');
        $('.edit-item').click(showEditItemModal);
    });
    if (table) {
        //table.draw();
    }

    $('input.item-type').change((event) => {
        if(event.target.getAttribute('type') !== 'checkbox'){
            return true;
        }
    
        const dataUpdate = {
            id: event.target.dataset.itemId,
            type: event.target.value,
            active: event.target.checked,
        }
        console.log(dataUpdate);
        console.log(event);
    
        postData('/update', dataUpdate)
            .then(data => {
                console.log(data); // JSON data parsed by `data.json()` call
            });
    });

    $('.collapsible').collapsible();
    $('.tooltipped').tooltip();
    $('.modal').modal();
    $('select').formSelect();

    $('.guess-wiki-link').click(function(event){
        let itemName = encodeURIComponent(decodeURIComponent($(event.target).data('itemName')).replace(/ /g, '_'));
        console.log(itemName);
        $('#wiki-link').val(`https://escapefromtarkov.fandom.com/wiki/${itemName}`);
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
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
            }
          });
        M.Modal.getInstance(document.getElementById('modal-edit-item')).close();
    });

    $('.filter-types-all').click(() => {
        $('input.filter-type').prop('checked', true);
        drawTable();
    });
    $('.filter-types-none').click(() => {
        $('input.filter-type').prop('checked', false);
        drawTable();
    });
    $('.filter-type').change(() => {
        drawTable();
    });

    $('.filter-special-all').click(() => {
        $('.filter-special[value="all"]').prop('checked', true);
        $('.filter-special[value!="all"]').prop('checked', false);
        drawTable();
    });
    $('.filter-special-none').click(() => {
        $('input.filter-special').prop('checked', false);
        drawTable();
    });
    $('.filter-special').change((event) => {
        const check = $(event.target);
        if (check.val() == 'all') {
            $('.filter-special[value!="all"]').prop('checked', !check.prop('checked'));
        } else if (check.prop('checked')) {
            $('.filter-special[value="all"]').prop('checked', false);
        }
        drawTable();
    });
} );

jQuery.fn.dataTableExt.afnFiltering.push(
    function( oSettings, aData, iDataIndex ) {
        const item = all_items[iDataIndex];
        let specialPassed = false;
        let typePassed = false;
        let specialChecked = jQuery('input.filter-special:checked');
        if (typeof specialChecked == 'undefined') return false;
        for (let i=0; i< specialChecked.length; i++) {
            const filter = jQuery(specialChecked[i]).val();
            if (filter === 'all') {
                specialPassed = true;
            } else if (filter === 'untagged') {
                if (item.types.length == 0) return true;
            } else if (filter === 'missing-image') {
                if (!aData[1] || !aData[2] || !aData[3]) specialPassed = true;
            } else if (filter === 'no-wiki') {
                if (!item.wiki_link) specialPassed = true;
            }
        }
        let typeChecked = jQuery('input.filter-type:checked');
        if (typeof typeChecked == 'undefined') return false;
        for (let i=0; i< typeChecked.length; i++) {
            if (item.types.includes(jQuery(typeChecked[i]).val())) {
                typePassed = true;
            }
        }
        return specialPassed && typePassed;
    }
);