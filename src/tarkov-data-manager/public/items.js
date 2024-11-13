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
        editModal.find('input[type="file"]').val('');
    }
    $('#modal-edit-item .image-download').attr('href', `/items/download-images/${item.id}`);
    const imageHolder = $('#modal-edit-item .source-image');
    imageHolder.empty();
    M.Modal.getInstance(document.getElementById('modal-edit-item')).open();
    //M.updateTextFields();
};

let table = false;

const drawTable = () => {
    if (table) table.draw();
};

const missingImageElement = (imageType) => {
    return `<span class="tooltipped" style="cursor: default" data-tooltip="${imageType} image">🚫</span>`;
};

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
                            <a class="waves-effect waves-light btn-small filled edit-item" data-item="${encodeURIComponent(JSON.stringify(item))}"><i class="material-icons">edit</i></a>
                        </div>
                    `;
                }
                if (type === 'filter') {
                    return data+item.id;
                }
                return data;
            },
            width: '10%',
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
                        ${imageLink ? `<div><img src="${imageLink}" loading="lazy" style="max-height: 200px" /></div>`: ''}
                        <div>
                            ${item.image_8x_link ? existingImageElement(item.id, '8x', item.image_8x_link): missingImageElement('8x')}
                            ${item.image_512_link ? existingImageElement(item.id, '512', item.image_512_link): missingImageElement('512')}
                            ${data ? existingImageElement(item.id, 'inspect', data): missingImageElement('inspect')}
                            ${item.base_image_link ? existingImageElement(item.id, 'base', item.base_image_link): missingImageElement('base')}
                            ${item.grid_image_link ? existingImageElement(item.id, 'grid', item.grid_image_link): missingImageElement('grid')}
                            ${item.icon_link ? existingImageElement(item.id, 'icon', item.icon_link) : missingImageElement('icon')}
                        </div>
                        <div>
                            ${item.image_8x_link || item.base_image_link ? `<a class="waves-effect waves-light regenerate btn-small tonal tooltipped" data-id="${item.id}" data-tooltip="Regenerate images from source"><i class="material-icons">refresh</i></a>` : ''}
                            <a class="waves-effect waves-light refresh-images btn-small tonal tooltipped" data-id="${item.id}" data-tooltip="Refresh images from game"><i class="material-icons">sync</i></a>
                        </div>
                    `;
                }
                return data;
            },
            className: 'image-column',
            width: '15%',
        },
        {
            data: 'types',
            render: (data, type, item) => {
                if (type === 'display') {
                    let markupString = '';
                    for(const type of AVAILABLE_TYPES){
                        markupString = `${markupString}
                        <div class="col s12 m6 l3 xl2">
                            <label for="${item.id}-${type}" class="no-wrap">
                                <input type="checkbox" class="item-type" id="${item.id}-${type}" value="${type}" data-item-id="${item.id}" ${data.includes(type) ? 'checked' : ''} />
                                <span>${type}</span>
                            </label>
                        </div>`;
                    }
                    return `<div class="row">${markupString}</div>`;
                }
                return data.join(',');
            }
        },
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
            try {
                M.AutoInit();
            } catch (error) {
                console.error('Error initializing materializecss', error);
            }
            //M.Tooltip.init($('.tooltipped'));
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
            
                postData(`/items/update-types/${event.target.dataset.itemId}`, dataUpdate).then(data => {
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

            $('.btn-small.regenerate').off('click');
            $('.btn-small.regenerate').click(event => {
                console.log(event);
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
                console.log(event);
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

    M.Collapsible.init($('.collapsible'));
    //M.Tooltip.init($('.tooltipped'));
    M.Modal.init($('.modal'));
    M.FormSelect.init($('select'));

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
            new M.Toast({text: data.message});
            if (data.errors.length > 0) {
                for (let i = 0; i < data.errors.length; i++) {
                    new M.Toast({text: data.errors[i]});
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

    $('.single-upload').change(event => {
        const url = URL.createObjectURL(event.target.files[0]);
        if (url) {
            const imageHolder = $(event.target).parent().find('.item-image');
            imageHolder.empty();
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
                if (!item.wiki_link && !item.types.includes('quest')) specialPassed = true;
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
        if (requireSelected === 'all') {
            typePassed = true;
        }
        if (typeChecked.length == 0 && item.types.length > 0) return false;
        if (item.types.length == 0 && allItems && (typeChecked.length == 0 || typeChecked.length == typeCount)) return true;
        return typePassed;
    }
);