const showEditItemModal = function(event){
    let link = $(event.target);
    if (event.target.nodeName != 'A') {
        link = $(event.target.parentNode);
    }
    const item = JSON.parse(decodeURIComponent(link.data('item')));
    const editModal = $('#modal-edit-item');
    for (const field in item) {
        editModal.find(`.item-content.${field}`).text(item[field]);
        editModal.find(`.item-value.${field}`).val(item[field]);
        editModal.find(`.item-attribute.${field}`).each(function(){
            const attributeName = $(this).data('attribute');
            let value = item[field];
            if ($(this).data('prependValue')) {
                value = $(this).data('prependValue')+value;
            }
            $(this).attr(attributeName, value);
        });
        editModal.find(`.item-image.${field}`).each(function(){
            $(this).empty();
            if (!item[field]) {
                $(this).text('N/A');
                return;
            }
            $(this).append(`<img src="${item[field]}" style="max-height: 240px" />`);
        });
        editModal.find('.item-base-image').each(function() {
            $(this).empty();
            if (!item.base_image_link) {
                $(this).text('N/A');
                return;
            }
            $(this).append(`<img src="${item.base_image_link}" />`);
        });
        editModal.find('input[type="file"]').val('');
    }
    $('#modal-edit-item .image-download').attr('href', `/items/download-images/${item.id}`);
    const imageHolder = $('#modal-edit-item .source-image');
    imageHolder.empty();
    M.Modal.getInstance(document.getElementById('modal-edit-item')).open();
    M.updateTextFields();
};

let table = false;

const drawTable = () => {
    if (table) table.draw();
};

$(document).ready( async function () {
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
                            <a href="https://tarkov.dev/item/${item.normalized_name}">Tarkov.dev</a>
                            <br>
                            <a class="waves-effect waves-light btn edit-item" data-item="${encodeURIComponent(JSON.stringify(item))}"><i class="material-icons">edit</i></a>
                        </div>
                    `;
                }
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
                        <div class="row">
                            ${item.image_8x_link ? '': '<span class="tooltipped" data-tooltip="8x image">🚫</span>'}
                            ${item.image_512_link ? '': '<span class="tooltipped" data-tooltip="512 image">🚫</span>'}
                            ${data ? '': '<span class="tooltipped" data-tooltip="inspect image">🚫</span>'}
                            ${item.base_image_link ? '': '<span class="tooltipped" data-tooltip="base image">🚫</span>'}
                            ${item.grid_image_link ? '': '<span class="tooltipped" data-tooltip="grid image">🚫</span>'}
                            ${item.icon_link ? '' : '<span class="tooltipped" data-tooltip="icon image">🚫</span>'}
                            ${item.image_8x_link || item.base_image_link ? `<a class="waves-effect waves-light regenerate btn" data-id="${item.id}" data-tooltip="Regenerate images from source"><i class="medium material-icons">refresh</i></a>` : ''}
                        </div>
                    `;
                }
                return data;
            },
            className: 'image-column'
        },
        /*{
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
        },*/
        {
            data: 'types',
            render: (data, type, item) => {
                if (type === 'display') {
                    let markupString = '<div class="row">';
                    for(const type of AVAILABLE_TYPES){
                        markupString = `${markupString}
                        <div class="col s12 l6 xl4 xxl3">
                            <label for="${item.id}-${type}">
                                <input type="checkbox" class="item-type" id="${item.id}-${type}" value="${type}" data-item-id="${item.id}" ${data.includes(type) ? 'checked' : ''} />
                                <span>${type}</span>
                            </label>
                        </div>`;
                    }
                    return `${markupString}</div>`;
                }
                return data.join(',');
            }
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
    ];

    table = $('table.main').DataTable({
        pageLength: 25,
        order: [[0, 'asc']],
        ajax: {
            url: '/items/get',
            dataSrc: ''
        },
        columns: columns,
        autoWidth: false,
        drawCallback: (settings) => {
            M.AutoInit();

            $('.edit-item').off('click');
            $('.edit-item').click(showEditItemModal);

            $('input.item-type').off('change');
            $('input.item-type').change((event) => {
                if(event.target.getAttribute('type') !== 'checkbox'){
                    return true;
                }
            
                const dataUpdate = {
                    id: event.target.dataset.itemId,
                    type: event.target.value,
                    active: event.target.checked,
                }
            
                postData('/update', dataUpdate).then(data => {
                    for (let i = 0; i < table.data().length; i++) {
                        const item = table.data()[i];
                        if (item.id !== event.target.dataset.itemId) continue;
                        if (event.target.checked) {
                            item.types.push(event.target.value)
                        } else {
                            item.types = item.types.filter(t => t !== event.target.value);
                        }
                        break;
                    }
                });
            });

            $('.btn.regenerate').click(event => {
                let target = event.target;
                if (target.nodeName !== 'A') {
                    target = target.parentElement;
                }
                $(target).addClass('disabled');
                fetch(`/items/regenerate-images/${$(target).data('id')}`, {method: 'POST'}).then(response => response.json()).then(data => {
                    $(target).removeClass('disabled');
                    M.toast({html: data.message});
                    for (const error of data.errors) {
                        M.toast({html: error});
                    }
                });
            });
        }
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
        const formData = new FormData(form[0]);
        fetch(form.attr('action'), {
            method: 'POST',
            body: formData
        }).then(response => response.json()).then(data => {
            M.toast({html: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    M.toast({html: data.errors[i]});
                }
            }
        });
        M.Modal.getInstance(document.getElementById('modal-edit-item')).close();
    });

    $('#source-upload').change(event => {
        const url = URL.createObjectURL(event.target.files[0]);
        const imageHolder = $('#modal-edit-item .source-image');
        imageHolder.empty();
        if (url) {
            imageHolder.append(`<img src="${url}">`);
        }
    });

    $('.filter-types-all').click(() => {
        $('input.filter-type').prop('checked', true);
        drawTable();
    });
    $('.filter-types-none').click(() => {
        $('input.filter-type').prop('checked', false);
        drawTable();
    });
    $('.filter-types-require-selected').change(() => {
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
        const item = table.data()[iDataIndex];
        let specialPassed = false;
        let allItems = false;
        let specialChecked = jQuery('input.filter-special:checked');
        if (typeof specialChecked == 'undefined') return false;
        for (let i=0; i< specialChecked.length; i++) {
            const filter = jQuery(specialChecked[i]).val();
            if (filter === 'all') {
                specialPassed = true;
                allItems = true;
            } else if (filter === 'missing-image') {
                if (!item.image_link || !item.grid_image_link || !item.icon_link || !item.image_512_link || !item.image_8x_link || !item.base_image_link) specialPassed = true;
            } else if (filter === 'no-wiki') {
                if (!item.wiki_link) specialPassed = true;
            }
            if (specialPassed) break;
        }
        if (!specialPassed) return false;
        let requireSelected = jQuery('input.filter-types-require-selected:checked').first().val(); 
        let typePassed = requireSelected === 'none';
        let typeChecked = jQuery('input.filter-type:checked');
        let typeCount = jQuery('input.filter-type').length;
        if (typeof typeChecked == 'undefined') return false;
        for (const selectedType of typeChecked) {
            if (requireSelected === 'all') {
                if (!item.types.includes(jQuery(selectedType).val())) {
                    return false;
                } 
                continue;
            }
            if (requireSelected === 'none') {
                if (item.types.includes(jQuery(selectedType).val())) {
                    return false;
                } 
                continue;
            }
            if (item.types.includes(jQuery(selectedType).val())) {
                typePassed = true;
                break;
            }
        }
        if (typeChecked.length == 0 && item.types.length > 0) return false;
        if (item.types.length == 0 && allItems && (typeChecked.length == 0 || typeChecked.length == typeCount)) return true;
        return typePassed;
    }
);