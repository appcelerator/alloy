var CU = require('../compilerUtils');
var U = require('../../../utils');
var fs = require('fs-extra');
var path = require('path');

exports.parse = function(node, state) {
	var args = CU.getParserArgs(node, state);
	var compilerConfig = CU.getCompilerConfig();
	var code = '';

	function getSourceCode(src) {
		if ( src) {
			const sourcePath = path.join(compilerConfig.dir.resourcesPlatform, src);
			if (fs.existsSync(sourcePath)) {
				return fs.readFileSync(sourcePath, 'utf8');
			} 
		}	
	}

	// get code from any external source
	code += getSourceCode(args.createArgs.src) || '';

	// get code from text node
	code += U.XML.getNodeText(node) || '';

	return {
		code: code.trim() + '\n\n',
	};
};
