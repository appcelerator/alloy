$.index.open();

function openDialog(e) {  
    Alloy.getController(e.source.title, {
    	message: 'Opened ' + e.source.title
    }).openDialog($.index);
}
