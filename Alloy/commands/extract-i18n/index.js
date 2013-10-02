var fs = require('fs'),
    path = require('path'),
    wrench = require('wrench'),
    CONST = require('../../common/constants'),
    U = require('../../utils'),
    _ = require("../../lib/alloy/underscore")._,
    logger = require('../../logger'),
    i18nHandler = require('./i18nHandler'),
    uglifyjs = require('uglify-js'),
    styler = require('./../compile/styler');

var properties = 'titleid|textid|messageid|titlepromptid|subtitleid|hinttextid|promptid'.split('|');

function extractStringsFromViewNodes(nodes, strings) {
    var elements = U.XML.getElementsFromNodes(nodes);

    // for each node
    _.each(elements, function(element) {

        // for each i18n property
        _.each(properties, function (property) {

            // has property as attribute
            if (element.hasAttribute(property)) {
                strings.push(element.getAttribute(property));
            }
        });

        // recurse childNodes
        if (element.hasChildNodes) {
            extractStringsFromViewNodes(element.childNodes, strings);
        }
    });

    return strings;
}

function extractStringsFromController(controller) {

    var code = fs.readFileSync(controller, 'utf8'),
        ast = uglifyjs.parse(code),
        strings = [];

    ast.walk(new uglifyjs.TreeWalker(function(node) {
        var property, value;

        // foo.titleid = 'bar'
        // foo['titleid'] = 'bar';
        if (node instanceof uglifyjs.AST_Assign && node.left instanceof uglifyjs.AST_PropAccess && node.operator === '=' && node.right instanceof uglifyjs.AST_String) {

            if (node.left instanceof uglifyjs.AST_Dot) {
                property = node.left.property;
            } else if (node.left.property instanceof uglifyjs.AST_String) {
                property = node.left.property.value;
            }

            value = node.right.value;

        // { titleid: 'bar' }
        } else if (node instanceof uglifyjs.AST_ObjectKeyVal && node.value.value) {
            property = node.key;
            value = node.value.value;

        // setTitleid('bar')
        } else if (node instanceof uglifyjs.AST_Call && node.expression instanceof uglifyjs.AST_PropAccess && node.args.length === 1 && node.args[0] instanceof uglifyjs.AST_String) {
            var method = (_.isString(node.expression.property) ? node.expression.property : node.expression.property.value);

            if (method.substr(0, 3) === 'set') {
                property = method.substr(3).toLowerCase();
                value = node.args[0].value;
            }
        }

        if (property && value && _.contains(properties, property)) {
            strings.push(value);
        }
    }));

    return strings;
}

function extractStringsFromStyleNodes(nodes, strings) {

    // for each node
    _.each(nodes, function (value, property) {

        // has string value
        if (_.isString(value)) {

            // is i18n property
            if (_.contains(properties, property)) {
                strings.push(value);
            }

        // recurse child nodes
        } else if (_.isObject(value)) {
            extractStringsFromStyleNodes(value, strings);
        }
    });

    return strings;
}

function extractStrings() {
    try {
        var sourceDir = paths.app;
        var files = wrench.readdirSyncRecursive(sourceDir);
        var styleSuffix = '.' + CONST.FILE_EXT.STYLE;
        var controllerSuffix = '.' + CONST.FILE_EXT.CONTROLLER;
        var viewSuffix = '.' + CONST.FILE_EXT.VIEW;

        var strings = [];
        _.each(files, function(f) {
            var file = path.join(sourceDir, f),
                found = 0;

            // view
            if (f.substr(-viewSuffix.length) === viewSuffix) {
                found = extractStringsFromViewNodes(U.XML.getAlloyFromFile(file).childNodes, []);

            // controller
            } else if (f.substr(-controllerSuffix.length) === controllerSuffix) {
                found = extractStringsFromController(file);

            // style
            } else if (f.substr(-styleSuffix.length) === styleSuffix) {
                found = extractStringsFromStyleNodes(styler.loadStyle(file), []);

            } else {
                return;
            }

            if (found.length > 0) {
                logger.debug(file + ': ' + found.length + ' strings found.');
                strings = _.union(strings, found);
            }
        });

        strings = _.uniq(strings);
        logger.info("Found " + strings.length + " unique i18n strings in code. Checking against current i18n file...");
        return strings;
    } catch(e) {
        U.die('Error extracting strings', e);
    }
}

module.exports = function(args, program) {
    paths = U.getAndValidateProjectPaths(
        program.outputPath || process.cwd()
    );
    var language = args[0] || 'en';
    logger.info('extract-i18n for "i18n/' + language + '/strings.xml"');

    var strings = extractStrings();
    var handler = i18nHandler(paths.project, language);
    var newStrings = handler.merge(strings);

    if (program.apply) {
        handler.write(newStrings);
    } else {
        handler.print(newStrings);
    }
};
