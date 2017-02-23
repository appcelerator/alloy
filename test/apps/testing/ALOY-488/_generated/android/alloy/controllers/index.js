function __processArg(obj, key) {
    var arg = null;
    if (obj) {
        arg = obj[key] || null;
        delete obj[key];
    }
    return arg;
}

function Controller() {
    function doClick(e) {
        alert($.label.text);
    }
    function doAlert(num) {
        alert("Your rating = " + num);
    }
    require("alloy/controllers/BaseController").apply(this, Array.prototype.slice.call(arguments));
    this.__controllerPath = "index";
    this.args = arguments[0] || {};
    if (arguments[0]) {
        __processArg(arguments[0], "__parentSymbol");
        __processArg(arguments[0], "$model");
        __processArg(arguments[0], "__itemTemplate");
    }
    var $ = this;
    var exports = {};
    var __defers = {};
    $.__views.index = Ti.UI.createWindow({
        backgroundColor: "white",
        id: "index"
    });
    $.__views.index && $.addTopLevelView($.__views.index);
    $.__views.starwidget = Alloy.createWidget("starrating", "widget", {
        id: "starwidget",
        max: 5,
        initialRating: 2.5,
        top: 20,
        __parentSymbol: $.__views.index
    });
    $.__views.starwidget.setParent($.__views.index);
    $.__views.label = Ti.UI.createLabel({
        width: Ti.UI.SIZE,
        height: Ti.UI.SIZE,
        color: "#000",
        font: {
            fontSize: 12
        },
        text: "Hello, World",
        id: "label",
        top: 100
    });
    $.__views.index.add($.__views.label);
    doClick ? $.addListener($.__views.label, "click", doClick) : __defers["$.__views.label!click!doClick"] = true;
    exports.destroy = function() {};
    _.extend($, $.__views);
    $.starwidget.init(doAlert);
    $.index.open();
    __defers["$.__views.label!click!doClick"] && $.addListener($.__views.label, "click", doClick);
    _.extend($, exports);
}

var Alloy = require("alloy"), Backbone = Alloy.Backbone, _ = Alloy._;

module.exports = Controller;