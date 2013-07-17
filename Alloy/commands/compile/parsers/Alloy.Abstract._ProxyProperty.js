var _ = require('../../../lib/alloy/underscore')._,
	U = require('../../../utils'),
	CU = require('../compilerUtils'),
	CONST = require('../../../common/constants');

function fixDefinition(def) {
	def = def || {};
	def = _.defaults(def, {
		parents: [],
		children: []
	});
	return def;
}

exports.parse = function(node, state) {
	return require('./base').parse(node, state, parse);
};

function parse(node, state, args) {
	var def = fixDefinition(state.proxyPropertyDefinition),
		code = '',
		proxy;

	// validate parent
	if (def.parents.length > 0 && state.parent && state.parent.node) {
		if (!CU.validateNodeName(state.parent.node, def.parents)) {
			U.dieWithNode(node, 'Parent element must one of the following: [' + def.parents.join(',') + ']');
		}
	}

	// process children
	_.each(U.XML.getElementsFromNodes(node.childNodes), function(child) {
		var childArgs = CU.getParserArgs(child, state);

		// validate children
		if (def.children.length > 0) {
			if (!CU.validateNodeName(child, def.children)) {
				U.dieWithNode(node, 'Child element must one of the following: [' + def.children.join(',') + ']');
			}
		}

		// generate proxy property
		code += CU.generateNodeExtended(child, state, {
			parent: {},
			post: function(node, state, args) {
				proxy = state.parent.symbol;
			}
		});
	});

	// assign proxy property to parent
	code += (state.parent && state.parent.symbol ? state.parent.symbol : CONST.PARENT_SYMBOL_VAR) +
		'.' + U.lcfirst(node.nodeName) + '=' + proxy + ';';

	return {
		parent: {},
		code: code
	};
}