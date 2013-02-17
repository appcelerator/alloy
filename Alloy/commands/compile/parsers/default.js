var CU = require('../compilerUtils'),
	U = require('../../../utils'),
	CONST = require('../../../common/constants'),
	_ = require('../../../lib/alloy/underscore')._;

exports.parse = function(node, state) {
	return require('./base').parse(node, state, parse);
};

function parse(node, state, args) {
	var createFunc = 'create' + node.nodeName,
		isCollectionBound = args[CONST.BIND_COLLECTION] ? true : false,
		code = '';

	// make symbol a local variable if necessary
	if (state.local) {
		args.symbol = CU.generateUniqueId();
	}

	var module = node.getAttribute('module');

	// check to see if this tag's view is coming from a user module instead of builtin Ti API
	// and if so, we need to load the module and use it by prefixing it to the API
	if (module)
	{
		if (!U.tiapp.isModuleDeclared(module,CU.compileConfig.alloyConfig.platform))
		{
			U.dieWithNode(node,'Required module ' + module.yellow + ' is not declared in tiapp.xml or is not available for ' + CU.compileConfig.alloyConfig.platform.blue);
		}
		var p = module.split('.'),
			m = p[p.length-1],
			createFunc = node.getAttribute('method') || 'create' + m[0].toUpperCase() + m.substring(1) + 'View';
		args.ns = 'require("'+module+'")';
		delete args.createArgs['module'] && delete args.createArgs['method'];
	}

	// Generate runtime code
	code += (state.local ? 'var ' : '') + args.symbol + " = " + args.ns + "." + createFunc + "(\n";
	code += CU.generateStyleParams(
		state.styles,
		args.classes,
		args.id,
		CU.getNodeFullname(node),
		_.defaults(state.extraStyle || {}, args.createArgs || {}),
		state
	) + '\n';
	code += ");\n";
	if (args.parent.symbol) {
		code += args.parent.symbol + ".add(" + args.symbol + ");\n";
	}

	if (isCollectionBound) {
		var localModel = CU.generateUniqueId();
		var itemCode = '';

		_.each(U.XML.getElementsFromNodes(node.childNodes), function(child) {
			itemCode += CU.generateNodeExtended(child, state, {
				parent: {
					node: node,
					symbol: args.symbol
				},
				local: true,
				model: localModel
			});
		});

		var pre =  "var children = " + args.symbol + ".children;" +
				   "for (var d = children.length-1; d >= 0; d--) {" + 
				   "	" + args.symbol + ".remove(children[d]);" +
				   "}";

		code += _.template(CU.generateCollectionBindingTemplate(args), {
			localModel: localModel,
			pre: pre,
			items: itemCode,
			post: ''
		});
	}

	// Update the parsing state
	return {
		parent: isCollectionBound ? {} : {
			node: node,
			symbol: args.symbol
		},
		local: state.local || false,
		model: state.model || undefined,
		condition: state.condition || undefined,
		styles: state.styles,
		code: code
	}
};