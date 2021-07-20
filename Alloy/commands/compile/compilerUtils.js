var U = require('../../utils'),
	colors = require('colors'),
	path = require('path'),
	os = require('os'),
	fs = require('fs-extra'),
	walkSync = require('walk-sync'),
	jsonlint = require('jsonlint'),
	logger = require('../../logger'),
	astController = require('./ast/controller'),
	_ = require('lodash'),
	styler = require('./styler'),
	XMLSerializer = require('xmldom').XMLSerializer,
	CONST = require('../../common/constants'),
	sourceMapper = require('./sourceMapper');

///////////////////////////////////////
////////// private variables //////////
///////////////////////////////////////
var alloyRoot = path.join(__dirname, '..', '..'),
	platformsDir = path.join(alloyRoot, '..', 'platforms'),
	alloyUniqueIdPrefix = '__alloyId',
	alloyUniqueIdCounter = 0,
	JSON_NULL = JSON.parse('null'),
	compilerConfig;

///////////////////////////////
////////// constants //////////
///////////////////////////////
var RESERVED_ATTRIBUTES = [
		'platform',
		'formFactor',
		'if',
		CONST.BIND_COLLECTION,
		CONST.BIND_WHERE,
		CONST.AUTOSTYLE_PROPERTY,
		'ns',
		'method',
		'module'
	],
	RESERVED_ATTRIBUTES_REQ_INC = [
		'platform',
		'type',
		'src',
		'formFactor',
		'if',
		CONST.BIND_COLLECTION,
		CONST.BIND_WHERE,
		CONST.AUTOSTYLE_PROPERTY,
		'ns',
		'method',
		'module'
	],
	RESERVED_EVENT_REGEX =  new RegExp(`^(?:(${CONST.PLATFORMS.join('|')}):)?on([A-Z].+)`);

// load CONDITION_MAP with platforms
exports.CONDITION_MAP = {
	handheld: {
		runtime: '!Alloy.isTablet'
	},
	tablet: {
		runtime: 'Alloy.isTablet'
	}
};
_.each(CONST.PLATFORMS, function(p) {
	exports.CONDITION_MAP[p] = require(path.join(platformsDir, p, 'index'))['condition'];
});

exports.bindingsMap = {};
exports.destroyCode = '';
exports.postCode = '';
exports.models = [];
exports.dataFunctionNames = {};

//////////////////////////////////////
////////// public interface //////////
//////////////////////////////////////
exports.getCompilerConfig = function() {
	return compilerConfig;
};

exports.generateVarName = function(id, name) {
	if (_.includes(CONST.JS_RESERVED_ALL, id)) {
		U.die([
			'Invalid ID "' + id + '" for <' + name + '>.',
			'Can\'t use reserved Javascript words as IDs.',
			'Reserved words: [' + CONST.JS_RESERVED_ALL.sort().join(',') + ']'
		]);
	}
	return '$.__views["' + id + '"]';
};

exports.generateUniqueId = function() {
	return alloyUniqueIdPrefix + alloyUniqueIdCounter++;
};

exports.getNodeFullname = function(node) {
	var name = node.nodeName,
		ns = node.getAttribute('ns') || CONST.IMPLICIT_NAMESPACES[name] || CONST.NAMESPACE_DEFAULT,
		fullname = ns + '.' + name;

	return fullname;
};

exports.isNodeForCurrentPlatform = function(node) {
	var isForCurrentPlatform =  !node.hasAttribute('platform') || !compilerConfig || !compilerConfig.alloyConfig;
	_.each(node.getAttribute('platform').split(','), function(p) {
		// need to account for multiple platforms and negation, such as
		// platform=ios,android   or   platform=!ios   or   platform="android,!mobileweb"
		p = p.trim();
		if (p === compilerConfig.alloyConfig.platform || (p.indexOf('!') === 0 && p.slice(1) !== compilerConfig.alloyConfig.platform)) {
			isForCurrentPlatform = true;
		}
	});
	return isForCurrentPlatform;
};
exports.getParserArgs = function(node, state, opts) {
	state = state || {};
	opts = opts || {};

	var defaultId = opts.defaultId || undefined,
		doSetId = opts.doSetId === false ? false : true,
		name = node.nodeName,
		ns = node.getAttribute('ns') || CONST.IMPLICIT_NAMESPACES[name] || CONST.NAMESPACE_DEFAULT,
		fullname = (ns && ns.length) ? (ns + '.' + name) : name,
		id = node.getAttribute('id') || defaultId || exports.generateUniqueId(),
		platform = node.getAttribute('platform'),
		formFactor = node.getAttribute('formFactor'),
		tssIf = node.getAttribute('if'),
		platformObj;

	// make sure we're not reusing the default ID for the first top level element
	if (id === exports.currentDefaultId &&
		(node.parentNode && node.parentNode.nodeName !== 'Alloy') &&
		!node.__idWarningHandled) {
		logger.warn([
			'<' + name + '> at line ' + node.lineNumber +
			' is using this view\'s default ID "' + id + '". ' +
			'Only a top-level element in a view should use the default ID'
		]);
		node.__idWarningHandled = true;
	}

	// handle binding arguments
	var bindObj = {};
	bindObj[CONST.BIND_COLLECTION] = node.getAttribute(CONST.BIND_COLLECTION);
	bindObj[CONST.BIND_WHERE] = node.getAttribute(CONST.BIND_WHERE);
	bindObj[CONST.BIND_TRANSFORM] = node.getAttribute(CONST.BIND_TRANSFORM);
	bindObj[CONST.BIND_FUNCTION] = node.getAttribute(CONST.BIND_FUNCTION);

	// cleanup namespaces and nodes
	ns = ns.replace(/^Titanium\./, 'Ti.');
	if (doSetId && !_.includes(CONST.MODEL_ELEMENTS, fullname)) {
		node.setAttribute('id', id);
	}

	// process the platform attribute
	if (platform) {
		platformObj = {};
		_.each((platform).split(','), function(p) {
			var matches = U.trim(p).match(/^(\!{0,1})(.+)/);
			if (matches !== null) {
				var negate = matches[1];
				var name = matches[2];
				if (_.includes(CONST.PLATFORMS, name)) {
					if (negate === '!') {
						_.each(_.without(CONST.PLATFORMS, name), function(n) {
							platformObj[n] = true;
						});
					} else {
						platformObj[name] = true;
					}
					return;
				}
			}
			U.die('Invalid platform type found: ' + p);
		});
	}

	// get create arguments and events from attributes
	var createArgs = {},
		events = [];
	var attrs = _.includes(['Alloy.Require'], fullname) ?
		RESERVED_ATTRIBUTES_REQ_INC :
		RESERVED_ATTRIBUTES;

	// determine whether to autoStyle this component
	// 1. autoStyle attribute
	// 2. autoStyle from <Alloy>
	// 3. autoStyle from config.json
	var autoStyle = (function() {
		var prop = CONST.AUTOSTYLE_PROPERTY;
		if (node.hasAttribute(prop)) {
			return node.getAttribute(prop) === 'true';
		} else {
			return exports[prop];
		}
	})();

	// TODO: Add the apiName until TIMOB-12553 is resolved
	if (autoStyle) {
		createArgs[CONST.APINAME_PROPERTY] = fullname;
	}

	_.each(node.attributes, function(attr) {
		var attrName = attr.nodeName;
		if (_.includes(attrs, attrName)) { return; }
		var matches = attrName.match(RESERVED_EVENT_REGEX);
		if (matches !== null && exports.isNodeForCurrentPlatform(node) && !_.includes(CONST.SPECIAL_PROPERTY_NAMES, attrName)) {
			if (matches[1] && compilerConfig.alloyConfig.platform !== matches[1]) {
				return;
			}
			events.push({
				name: U.lcfirst(matches[2]),
				value: node.getAttribute(attrName)
			});
		} else {
			var theValue = node.getAttribute(attrName);

			// find platform specific attributes
			var attributeParts = attrName.split(':');
			if ( attributeParts.length === 2 && _.includes(CONST.PLATFORMS, attributeParts[0])) {
				// if this attribute is for this platform, create it without namespace.
				if ( attributeParts[0] === compilerConfig.alloyConfig.platform ) {
					attrName = attributeParts[1];
				} else {
					return;
				}
			}	

			if (/(^|\+)\s*(?:(?:Ti|Titanium|Alloy.Globals|Alloy.CFG|\$.args)\.|L\(.+\)\s*$|WPATH\()/.test(theValue)) {
				var match = theValue.match(/^\s*L\([^'"]+\)\s*$/);
				if (match !== null) {
					theValue = theValue.replace(/\(/g, '("').replace(/\)/g, '")');
				}
				theValue = styler.STYLE_EXPR_PREFIX + theValue;
			}

			if ( theValue.startsWith('~/')) {
				theValue = styler.STYLE_EXPR_PREFIX + 'WPATH("' + theValue.substring(2, theValue.length) + '")';
			}

			if (attrName === 'class') {
				if (autoStyle) {
					createArgs[CONST.CLASS_PROPERTY] = theValue.split(/\s+/) || [];
				}
			} else {
				if (theValue === 'true') {
					theValue = true;
				} else if (theValue === 'false') {
					theValue = false;
				} else {
					var n = parseInt(theValue);
					if (!isNaN(n) && String(n) === theValue.trim()) {
						theValue = n;
					} else {
						n = parseFloat(theValue);
						if (!isNaN(n) && String(n) === theValue.trim()) {
							theValue = n;
						}
					}
				}
				_.set(createArgs, attrName, theValue );
			}
		}
	});

	if (autoStyle && !createArgs[CONST.CLASS_PROPERTY]) {
		createArgs[CONST.CLASS_PROPERTY] = [];
	}

	return _.extend({
		ns: ns,
		name: name,
		id: id,
		fullname: fullname,
		formFactor: node.getAttribute('formFactor'),
		symbol: exports.generateVarName(id, name),
		classes: node.getAttribute('class').split(' ') || [],
		tssIf: node.getAttribute('if').split(',') || [],
		parent: state.parent || {},
		platform: platformObj,
		createArgs: createArgs,
		events: events
	}, bindObj);
};

exports.generateNodeExtended = function(node, state, newState) {
	return exports.generateNode(node, _.extend(_.clone(state), newState));
};

exports.generateNode = function(node, state, defaultId, isTopLevel, isModelOrCollection) {
	if (node.nodeType != 1) return '';
	if (!exports.isNodeForCurrentPlatform(node)) {
		return '';
	}

	var args = exports.getParserArgs(node, state, { defaultId: defaultId }),
		codeTemplate = 'if (<%= condition %>) {\n<%= content %>}\n',
		code = {
			content: '',
			pre: ''
		};

	// Check for platform specific considerations
	var conditionType = compilerConfig && compilerConfig.alloyConfig && compilerConfig.alloyConfig.platform ? 'compile' : 'runtime';
	if (args.platform) {
		var conditionArray = [];
		_.each(args.platform, function(v, k) {
			conditionArray.push(exports.CONDITION_MAP[k][conditionType]);
		});

		code.condition = '(' + conditionArray.join(' || ') + ')';
	}

	//Add form factor condition, if application form-factor specific runtime check
	if (args.formFactor && exports.CONDITION_MAP[args.formFactor]) {
		var check = exports.CONDITION_MAP[args.formFactor].runtime;
		code.condition = (code.condition) ? code.condition += ' && ' + check : check;
	}

	// ALOY-871: add the if condition check
	args.tssIf = _.compact(args.tssIf);
	if (args.tssIf.length > 0) {
		if (code.condition) {
			code.condition += (' && (' + args.tssIf.join(' || ') + ')');
		} else {
			code.condition = args.tssIf.join(' || ');
		}
	}

	// pass relevant conditional information in state
	if (code.condition) {
		if (state.condition) {
			state.condition += '&&' + code.condition;
		} else {
			state.condition = code.condition;
		}
	}

	// Determine which parser to use for this node
	var parsersDir = path.join(alloyRoot, 'commands', 'compile', 'parsers');
	var parserRequire = 'default';
	if (_.includes(fs.readdirSync(parsersDir), args.fullname + '.js')) {
		parserRequire = args.fullname + '.js';
	}

	// Execute the appropriate tag parser and append code
	var isLocal = state.local;
	// [ALOY-787] keeping track of widget id
	var widgetId = state.widgetId;
	state = require('./parsers/' + parserRequire).parse(node, state) || { parent: {} };
	code.content += state.code;
	state.widgetId = widgetId;

	// Use local variable if given
	if (isLocal && state.parent) { args.symbol = state.parent.symbol || args.symbol; }

	// Use manually given args.symbol if present
	if (state.args) { args.symbol = state.args.symbol || args.symbol; }

	// add to list of top level views, if its top level
	if (isTopLevel) {
		if (state.isProxyProperty) {
			delete state.isProxyProperty;
			code.content += state.parent.symbol + ' && $.addProxyProperty("' + state.propertyName +
				'", ' + state.parent.symbol + ');\n';
		} else {
			code.content += args.symbol + ' && $.addTopLevelView(' + args.symbol + ');\n';
		}
	}

	// handle any model/collection code
	if (state.modelCode) {
		code.pre += state.modelCode;
		delete state.modelCode;
	}

	// handle any events from markup
	if (args.events && args.events.length > 0 &&
		!_.includes(CONST.SKIP_EVENT_HANDLING, args.fullname) &&
		!state.isViewTemplate) {
		// determine which function name to use for event handling:
		// * addEventListener() for Titanium proxies
		// * on() for everything else (controllers, models, collections)
		var eventFunc = /^Alloy\.(?:Collection|Model|Require|Widget)/.test(args.fullname) ?
			'on' : 'addEventListener';

		_.each(args.events, function(ev) {
			var eventObj = {
					obj: isModelOrCollection ? state.args.symbol : args.symbol,
					ev: ev.name,
					cb: ev.value,
					escapedCb: ev.value.replace(/'/g, "\\'"),
					func: eventFunc
				},
				postCode;

			if (_.includes(['Alloy.Widget', 'Alloy.Require'], args.fullname)) {
				eventObj.obj = state.controller;
			}

			// create templates for immediate and deferred event handler creation
			var theDefer = _.template("__defers['<%= obj %>!<%= ev %>!<%= escapedCb %>']")(eventObj);
			var theEvent;
			if (eventFunc === 'addEventListener') {
				theEvent = _.template("$.addListener(<%= obj %>,'<%= ev %>',<%= cb %>)")(eventObj);
			} else {
				theEvent = _.template("<%= obj %>.<%= func %>('<%= ev %>',<%= cb %>)")(eventObj);
			}
			var deferTemplate = theDefer + ' && ' + theEvent + ';';
			var immediateTemplate;
			if (/[\.\[]/.test(eventObj.cb)) {
				immediateTemplate = 'try{' + theEvent + ';}catch(e){' + theDefer + '=true;}';
			} else {
				immediateTemplate = '<%= cb %>?' + theEvent + ':' + theDefer + '=true;';
			}

			// add the generated code to the view code and post-controller code respectively
			code.content += _.template(immediateTemplate)(eventObj);
			postCode = _.template(deferTemplate)(eventObj);
			exports.postCode += state.condition ? _.template(codeTemplate)({
				condition: state.condition,
				content: postCode
			}) : postCode;
		});
	}

	// Continue parsing if necessary
	if (state.parent) {
		var states = _.isArray(state.parent) ? state.parent : [state.parent];
		_.each(states, function(p) {
			var parent = p.node;
			if (!parent) { return; }
			for (var i = 0, l = parent.childNodes.length; i < l; i++) {
				var newState = _.defaults({ parent: p }, state);
				if (node.hasAttribute('formFactor') || state.parentFormFactor) {
					// propagate the form factor down through the hierarchy
					newState.parentFormFactor = (node.getAttribute('formFactor') || state.parentFormFactor);
				}
				code.content += exports.generateNode(parent.childNodes.item(i), newState);
			}
		});
	}

	if (!isModelOrCollection) {
		return code.condition ? _.template(codeTemplate)(code) : code.content;
	} else {
		return {
			content: code.condition ? _.template(codeTemplate)(code) : code.content,
			pre: code.condition ? _.template(codeTemplate)({content:code.pre}) : code.pre
		};
	}
};

exports.expandRequireNode = function(requireNode, doRecursive) {
	var cloneNode = requireNode.cloneNode(true);

	function getViewRequirePath(node) {
		var regex = new RegExp('\\.' + CONST.FILE_EXT.VIEW + '$'),
			src = node.getAttribute('src'),
			fullname = exports.getNodeFullname(node),
			name = node.getAttribute('name') || CONST.NAME_WIDGET_DEFAULT,
			type = fullname === 'Alloy.Widget' ? 'widget' : node.getAttribute('type') || CONST.REQUIRE_TYPE_DEFAULT,
			fullpaths = [];

		var platform;
		if (compilerConfig && compilerConfig.alloyConfig && compilerConfig.alloyConfig.platform) {
			platform = compilerConfig.alloyConfig.platform;
		}

		// Must be a view, with a valid src, in a <Require> element
		if (!src) {
			return null;
		} else if (fullname === 'Alloy.Require' && type === 'view') {
			if (platform) { fullpaths.push(path.join(compilerConfig.dir.views, platform, src)); }
			fullpaths.push(path.join(compilerConfig.dir.views, src));
		} else if (fullname === 'Alloy.Widget' ||
			(fullname === 'Alloy.Require' && type === 'widget')) {
			U.getWidgetDirectories(compilerConfig.dir.home).forEach(function(wDir) {
				if (wDir.manifest.id === src) {
					if (platform) {
						fullpaths.push(path.join(wDir.dir, CONST.DIR.VIEW, platform, name));
					}
					fullpaths.push(path.join(wDir.dir, CONST.DIR.VIEW, name));
				}
			});
		} else {
			return null;
		}

		// check the extensions on the paths to check
		var found = false;
		var fullpath;
		for (var i = 0; i < fullpaths.length; i++) {
			fullpath = fullpaths[i];
			fullpath += regex.test(fullpath) ? '' :  '.' + CONST.FILE_EXT.VIEW;
			if (fs.existsSync(fullpath)) {
				found = true;
				break;
			}
		}

		// abort if there's no view to be found
		if (!found) {
			U.die([
				type + ' "' + src + '" ' + (type === 'widget' ? 'view "' + name + '" ' : '') +
					'does not exist.',
				'The following paths were inspected:'
			].concat(fullpaths));
		}

		return fullpath;
	}

	//create function, it expects 2 values.
	function insertAfter(newElement, targetElement) {
		//target is what you want it to go after. Look for this elements parent.
		var parent = targetElement.parentNode;

		//if the parents lastchild is the targetElement...
		if (parent.lastchild == targetElement) {
			//add the newElement after the target element.
			parent.appendChild(newElement);
		} else {
			// else the target has siblings, insert the new element between the target and it's next sibling.
			parent.insertBefore(newElement, targetElement.nextSibling);
		}
	}

	function processRequire(node, isFirst) {
		// make sure we have a valid required view and get its path
		var fullpath = getViewRequirePath(node);
		if (fullpath === null) {
			return;
		}

		// re-assemble XML with required elements
		if (isFirst) {
			cloneNode = U.XML.getAlloyFromFile(fullpath);
		} else {
			var newDocRoot = U.XML.getAlloyFromFile(fullpath);
			_.each(U.XML.getElementsFromNodes(newDocRoot.childNodes), function(n) {
				insertAfter(n, node);
			});

			node.parentNode.removeChild(node);
		}
	}

	// Expand the <Require>, recursively if specified
	if (getViewRequirePath(cloneNode) !== null) {
		processRequire(cloneNode, true);
		while (doRecursive) {
			var reqs = cloneNode.getElementsByTagName('Require');
			var widgets = cloneNode.getElementsByTagName('Widget');
			var all = [];

			// condense node lists into a single array
			_.each(reqs, function(req) {
				all.push(req);
			});
			_.each(widgets, function(widget) {
				all.push(widget);
			});

			// find all the valid widgets/requires
			var viewRequires = _.filter(reqs, function(req) {
				return getViewRequirePath(req) !== null;
			});

			if (viewRequires.length === 0) {
				break;
			}

			// TODO: https://jira.appcelerator.org/browse/ALOY-256
			//_.each(viewRequires, processRequire);
			processRequire(viewRequires[0]);
		}
	}

	return cloneNode;
};

exports.inspectRequireNode = function(node) {
	var newNode = exports.expandRequireNode(node, true);
	var children = U.XML.getElementsFromNodes(newNode.childNodes);
	var names = [];

	_.each(children, function(c) {
		var args = exports.getParserArgs(c);

		// skip model elements when inspecting nodes for <Require>
		if (_.includes(CONST.MODEL_ELEMENTS, args.fullname)) {
			newNode.removeChild(c);
			return;
		}

		names.push(args.fullname);
	});

	return {
		children: U.XML.getElementsFromNodes(newNode.childNodes),
		length: names.length,
		names: names
	};
};

exports.copyWidgetResources = function(resources, resourceDir, widgetId, opts) {

	opts = opts || {};
	var platform;
	if (compilerConfig && compilerConfig.alloyConfig && compilerConfig.alloyConfig.platform) {
		platform = compilerConfig.alloyConfig.platform;
	}

	_.each(resources, function(dir) {
		if (!path.existsSync(dir)) { return; }
		logger.trace('WIDGET_SRC=' + path.relative(compilerConfig.dir.project, dir));
		var files = walkSync(dir);
		_.each(files, function(file) {
			file = path.normalize(file);
			var source = path.join(dir, file);

			// make sure the file exists and that it is not filtered
			if (!fs.existsSync(source) ||
				(opts.filter && opts.filter.test(file)) ||
				(opts.exceptions && _.includes(opts.exceptions, file))) {
				return;
			}

			if (fs.statSync(source).isFile()) {
				var dirname = path.dirname(file);
				var parts = dirname.split(/[\/\\]/);
				if (opts.titaniumFolder && parts[0] === opts.titaniumFolder) {
					dirname = parts.slice(1).join('/');
				}

				var destDir = path.join(resourceDir, dirname, widgetId);
				var dest = path.join(destDir, path.basename(file));
				if (!path.existsSync(destDir)) {
					fs.mkdirpSync(destDir);
				}

				logger.trace('Copying ' + file.yellow + ' --> ' +
					path.relative(compilerConfig.dir.project, dest).yellow + '...');
				U.copyFileSync(source, dest);

				if (path.extname(source) === '.js' && compilerConfig.sourcemap) {
					sourceMapper.generateSourceMap({
						target: {
							filename: file,
							filepath: dest,
						},
						data: {},
						origFile: {
							filename: file,
							filepath: source
						}
					}, compilerConfig);
				}
			}
		});

		// [ALOY-1002] Remove ios folder copied from widget
		var iosDir = path.join(resourceDir, 'ios');
		if (fs.existsSync(iosDir)) {
			fs.removeSync(iosDir);
		}
		logger.trace(' ');
	});

	if (opts.theme) {
		// if this widget has been themed, copy its theme assets atop the stock ones
		var widgetThemeDir = path.join(compilerConfig.dir.project, 'app', 'themes', opts.theme, 'widgets', widgetId);
		if (fs.existsSync(widgetThemeDir)) {
			logger.trace('Processing themed widgets');
			var widgetAssetSourceDir = path.join(widgetThemeDir, 'assets');
			var widgetAssetTargetDir = path.join(resourceDir, widgetId);
			if (fs.existsSync(widgetAssetSourceDir)) {
				fs.copySync(widgetAssetSourceDir, widgetAssetTargetDir, {preserveTimestamps: true});
			}
			// platform-specific assets from the widget must override those of the theme
			if (platform && path.existsSync(path.join(resources[0], platform))) {
				fs.copySync(path.join(resources[0], platform), widgetAssetTargetDir, {preserveTimestamps: true});
			}
			// however platform-specific theme assets must override the platform assets from the widget
			if (platform && path.existsSync(path.join(widgetAssetSourceDir, platform))) {
				logger.trace('Processing platform-specific theme assets for the ' + widgetId + ' widget');
				widgetAssetSourceDir = path.join(widgetAssetSourceDir, platform);
				fs.copySync(widgetAssetSourceDir, widgetAssetTargetDir, {preserveTimestamps: true});
			}

			// [ALOY-1002] Remove platform-specific folders copied from theme
			if (fs.existsSync(widgetAssetTargetDir)) {
				var files = walkSync(widgetAssetTargetDir);
				_.each(files, function(file) {
					var source = path.join(widgetAssetTargetDir, file);
					if (path.existsSync(source) && fs.statSync(source).isDirectory()) {
						fs.removeSync(source);
					}
				});
			}
		}
	}
};

exports.mergeI18N = function mergeI18N(src, dest, opts) {
	var serializer = new XMLSerializer();
	opts || (opts = {});

	(function walk(src, dest) {
		if (!fs.existsSync(src)) return;

		fs.readdirSync(src).forEach(function (name) {
			var srcFile = path.join(src, name);
			var destFile = path.join(dest, name);

			if (!fs.existsSync(srcFile)) return;

			if (fs.statSync(srcFile).isDirectory()) {
				if (!fs.existsSync(destFile)) {
					fs.mkdirpSync(destFile);
				}
				return walk(srcFile, destFile);
			}

			if (!fs.existsSync(destFile)) {
				logger.debug('Writing ' + destFile.yellow);
				return U.copyFileSync(srcFile, destFile);
			}

			if (!/\.xml$/.test(srcFile)) {
				return;
			}

			// merge!
			var existing = {};
			var destXml = U.XML.parseFromFile(destFile);
			var destDoc = destXml.documentElement;
			var srcXml = U.XML.parseFromFile(srcFile);
			var srcDoc = srcXml.documentElement;

			if (!destDoc) {
				U.die('Error processing "' + destFile + '"');
			}

			if (!srcDoc) {
				U.die('Error processing "' + srcFile + '"');
			}

			_.each(destDoc.getElementsByTagName('string'), function (node) {
				var name = node.getAttribute('name');
				existing[name] = node;
			});

			_.each(srcDoc.getElementsByTagName('string'), function (node) {
				var name = node.getAttribute('name');
				if (!Object.prototype.hasOwnProperty.call(existing, name)) {
					destDoc.appendChild(destXml.createTextNode('\t'));
					destDoc.appendChild(node);
					destDoc.appendChild(destXml.createTextNode('\n'));
				} else if (opts.override) {
					destDoc.replaceChild(node, existing[name]);
				}
			});

			logger.debug('Merging ' + srcFile.yellow + ' --> ' + destFile.yellow);
			fs.writeFileSync(destFile, serializer.serializeToString(destXml), 'utf8');
		});
	}(src, dest));
};

function updateImplicitNamspaces(platform) {
	switch (platform) {
		case 'android':
			break;
		case 'ios':
			break;
		case 'mobileweb':
			CONST.IMPLICIT_NAMESPACES.NavigationGroup = 'Ti.UI.MobileWeb';
			break;
	}
}

exports.createCompileConfig = function(inputPath, outputPath, alloyConfig, buildLog) {
	var dirs = ['assets', 'config', 'controllers', 'lib', 'migrations', 'models', 'styles', 'themes', 'vendor', 'views', 'widgets'];
	var libDirs = ['builtins', 'template'];
	var resources = path.resolve(path.join(outputPath, 'Resources'));

	var obj = {
		alloyConfig: alloyConfig,
		dir: {
			home: path.resolve(inputPath),
			project: path.resolve(outputPath),
			resources: resources,
			resourcesAlloy: path.join(resources, 'alloy')
		},
		buildLog: buildLog
	};

	// create list of dirs
	_.each(dirs, function(dir) {
		obj.dir[dir] = path.resolve(path.join(inputPath, dir));
	});
	_.each(libDirs, function(dir) {
		obj.dir[dir] = path.resolve(path.join(alloyRoot, dir));
	});

	// ensure the generated directories exist
	U.ensureDir(obj.dir.resources);

	// process and normalize the config.json file
	var configs = _.defaults(generateConfig(obj), {
		// sets the theme
		theme: undefined,

		// are we going to generate sourcemaps?
		sourcemap: true,

		// are we enabling dynamic styling for all generated components?
		autoStyle: false,

		// the list of widget dependencies
		dependencies: {},

		// TODO: Include no adapters by default
		adapters: CONST.ADAPTERS
	});

	// normalize adapters
	if (!configs.adapters) {
		configs.adapters = [];
	} else if (!_.isArray(configs.adapters)) {
		configs.adapters = [configs.adapters];
	}

	logger.debug(JSON.stringify(configs, null, '  ').split(os.EOL));

	// update implicit namespaces, if possible
	updateImplicitNamspaces(alloyConfig.platform);

	// keep a copy of the config for this module
	compilerConfig = _.extend(obj, configs);

	return obj;
};

function generateConfig(obj) {
	var buildLog = obj.buildLog;
	var o = {};
	var alloyConfig = obj.alloyConfig;
	var platform = require('../../../platforms/' + alloyConfig.platform + '/index').titaniumFolder;
	//var defaultCfg = 'module.exports=' + JSON.stringify(o) + ';';

	// get the app and resources locations
	var appCfg = path.join(obj.dir.home, 'config.' + CONST.FILE_EXT.CONFIG);
	var resourcesBase = (function() {
		var base = obj.dir.resources;
		if (platform) { base = path.join(base, platform); }
		return path.join(base, 'alloy');
	})();
	var resourcesCfg = path.join(resourcesBase, 'CFG.js');

	// parse config.json, if it exists
	if (path.existsSync(appCfg)) {
		o = exports.parseConfig(appCfg, alloyConfig, o);

		if (o.theme) {
			var themeCfg = path.join(obj.dir.home, 'themes', o.theme, 'config.' + CONST.FILE_EXT.CONFIG);

			// parse theme config.json, if it exists
			if (path.existsSync(themeCfg)) {
				o = exports.parseConfig(themeCfg, alloyConfig, o);
			}
		}
	}

	// only regenerate the CFG.js when necessary
	var hash = U.createHashFromString(JSON.stringify(o));
	if (buildLog.data.cfgHash && buildLog.data.cfgHash === hash && fs.existsSync(path.join(obj.dir.resources, 'alloy', 'CFG.js'))) {
		// use cached CFG.js file
		logger.info(' [config.json] config.json unchanged, using cached config.json...');
	} else {
		// cached CFG.js is out of sync with config.json, regenerate and save
		logger.info(' [config.json] regenerating CFG.js from config.json...');
		buildLog.data.cfgHash = hash;
		// write out the config runtime module
		fs.mkdirpSync(resourcesBase);

		//logger.debug('Writing "Resources/' + (platform ? platform + '/' : '') + 'alloy/CFG.js"...');
		var output = 'module.exports=' + JSON.stringify(o) + ';';
		fs.writeFileSync(resourcesCfg, output);

		// TODO: deal with TIMOB-14884
		var baseFolder = path.join(obj.dir.resources, 'alloy');
		if (!fs.existsSync(baseFolder)) {
			fs.mkdirpSync(baseFolder);
		}
		fs.writeFileSync(path.join(baseFolder, 'CFG.js'), output);
	}

	return o;
}

exports.parseConfig = function(file, alloyConfig, o) {
	var j, distType;
	try {
		j = jsonlint.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		U.die('Error processing "config.' + CONST.FILE_EXT.CONFIG + '"', e);
	}

	_.each(j, function(v, k) {
		if (!/^(?:env\:|os\:|dist\:)/.test(k) && k !== 'global') {
			logger.debug(k + ' = ' + JSON.stringify(v));
			o[k] = v;
		}
	});

	if (alloyConfig) {
		o = _.extend(o, j['global']);
		o = _.extend(o, j['env:' + alloyConfig.deploytype]);
		o = _.extend(o, j['os:' + alloyConfig.platform]);
		o = _.extend(o, j['env:' + alloyConfig.deploytype + ' os:' + alloyConfig.platform]);
		o = _.extend(o, j['os:' + alloyConfig.platform + ' env:' + alloyConfig.deploytype]);

		if (alloyConfig.deploytype === 'production' && alloyConfig.target) {
			distType = _.find(CONST.DIST_TYPES, function (obj) { return obj.value.indexOf(alloyConfig.target) !== -1; });
			if (distType) {
				distType = distType.key.toLowerCase().replace('_', ':');
				o = _.extend(o, j[distType]);
				o = _.extend(o, j['os:' + alloyConfig.platform + ' ' + distType]);
			}
		}
		if (alloyConfig.theme) {
			o.theme = alloyConfig.theme;
		}
	}

	return o;
};

exports.loadController = function(file) {
	var code = {
			parentControllerName: '',
			controller: '',
			pre: '',
			es6mods: ''
		},
		contents;

	// Read the controller file
	try {
		if (!path.existsSync(file)) {
			return code;
		}
		contents = fs.readFileSync(file, 'utf8');
	} catch (e) {
		U.die('Error reading controller file "' + file + '".', e);
	}

	// get the base controller for this controller, also process import/export statements
	var controller = astController.processController(contents, file);
	code.controller = controller.code;
	code.parentControllerName = controller.base;
	code.es6mods = controller.es6mods;

	return code;
};

exports.validateNodeName = function(node, names) {
	var fullname = exports.getNodeFullname(node);
	var ret = null;
	if (!_.isArray(names)) { names = [names]; }

	// Is the node name in the given list of valid names?
	ret = _.find(names, function(name) { return name === fullname; });
	if (ret) { return ret; }

	// Is it an Alloy.Require?
	if (fullname === 'Alloy.Require' || fullname === 'Alloy.Widget') {
		var inspect = exports.inspectRequireNode(node);
		ret = _.find(inspect.children, function(n) {
			return _.includes(names, exports.getNodeFullname(n));
		});
		if (ret) {
			return exports.getNodeFullname(ret);
		}
	}

	return null;
};

exports.generateCollectionBindingTemplate = function(args) {
	var code = '';
	var COLLECTION_BINDING_EVENTS = CONST.COLLECTION_BINDING_EVENTS_092;
	
	// Check if not 0.9.2 and if it's a supported version as we'll default to 0.9.2 if the version is not supported
	if (compilerConfig.backbone !== '0.9.2' && CONST.SUPPORTED_BACKBONE_VERSIONS.includes(compilerConfig.backbone)) {
		COLLECTION_BINDING_EVENTS = CONST.COLLECTION_BINDING_EVENTS;
	}

	// Determine the collection variable to use
	var obj = { name: args[CONST.BIND_COLLECTION] };
	var col = _.template((exports.currentManifest ? CONST.WIDGET_OBJECT : 'Alloy') + ".Collections['<%= name %>'] || <%= name %>")(obj);
	var colVar = exports.generateUniqueId();

	// Create the code for the filter and transform functions
	var where = args[CONST.BIND_WHERE];
	var transform = args[CONST.BIND_TRANSFORM];
	var whereCode = where ? where + '(' + colVar + ')' : colVar + '.models';
	var transformCode = transform ? transform + '(<%= localModel %>)' : '_.isFunction(<%= localModel %>.transform)?<%= localModel %>.transform():<%= localModel %>.toJSON()';
	var handlerFunc = args[CONST.BIND_FUNCTION] || exports.generateUniqueId();
	if (args.parentFormFactor) {
		if (!exports.dataFunctionNames[handlerFunc]) {
			exports.dataFunctionNames[handlerFunc] = [];
		}
		exports.dataFunctionNames[handlerFunc].push(args.parentFormFactor);
		// append the form factor for the code below
		handlerFunc += U.ucfirst(args.parentFormFactor);
	}
	// construct code template
	code += 'var ' + colVar + '=' + col + ';';
	code += 'function ' + handlerFunc + '(e) {';
	code += '   if (e && e.fromAdapter) { return; }';
	code += '   var opts = ' + handlerFunc + '.opts || {};';
	code += '	var models = ' + whereCode + ';';
	code += '	var len = models.length;';
	code += '<%= pre %>';
	code += '	for (var i = 0; i < len; i++) {';
	code += '		var <%= localModel %> = models[i];';
	if (!args.isDataBoundMap) {
		code += '		<%= localModel %>.' + CONST.BIND_TRANSFORM_VAR + ' = ' + transformCode + ';';
	} else {
		// because (ti.map).annotations[] doesn't accept an array of anonymous objects
		// we convert them to actual Annotations before pushing them to the array
		code += "		<%= annotationArray %>.push(require('ti.map').createAnnotation(" + transformCode + '));';
	}
	code += '<%= items %>';
	code += '	}';
	code += '<%= post %>';
	code += '};';
	code += colVar + ".on('" + COLLECTION_BINDING_EVENTS + "'," + handlerFunc + ');';

	exports.destroyCode += colVar + ' && ' + ((args.parentFormFactor) ? 'Alloy.is' + U.ucfirst(args.parentFormFactor) + ' && ' : '' ) +
		colVar + ".off('" + COLLECTION_BINDING_EVENTS + "'," + handlerFunc + ');';

	return code;
};
