function Controller() {
    require("alloy/controllers/BaseController").apply(this, Array.prototype.slice.call(arguments));
    this.__controllerPath = "index";
    arguments[0] ? arguments[0]["__parentSymbol"] : null;
    arguments[0] ? arguments[0]["$model"] : null;
    arguments[0] ? arguments[0]["__itemTemplate"] : null;
    var $ = this;
    var exports = {};
    $.__views.win = Ti.UI.createWindow({
        backgroundColor: "#f00",
        id: "win"
    });
    $.__views.win && $.addTopLevelView($.__views.win);
    $.__views.osLabel = Ti.UI.createLabel(function() {
        var o = {};
        _.extend(o, {
            color: "#fff",
            height: Ti.UI.SIZE,
            width: Ti.UI.SIZE,
            textAlign: "center",
            font: {
                fontSize: 48,
                fontWeight: "bold"
            }
        });
        Alloy.isTablet && _.extend(o, {
            font: {
                fontSize: 96,
                fontWeight: "bold"
            }
        });
        _.extend(o, {
            text: "iOS device\n(size unknown)"
        });
        Alloy.isTablet && _.extend(o, {
            text: "iPad"
        });
        _.extend(o, {});
        Alloy.isHandheld && _.extend(o, {
            text: "iPhone"
        });
        _.extend(o, {
            id: "osLabel"
        });
        return o;
    }());
    $.__views.win.add($.__views.osLabel);
    exports.destroy = function() {};
    _.extend($, $.__views);
    $.win.open();
    require("specs/index")($);
    _.extend($, exports);
}

var Alloy = require("alloy"), Backbone = Alloy.Backbone, _ = Alloy._;

module.exports = Controller;