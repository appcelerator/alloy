var ejs = require('ejs'),
	path = require('path'),
	fs = require('fs-extra'),
	walkSync = require('walk-sync'),
	chmodr = require('chmodr'),
	vm = require('vm'),
	babel = require('@babel/core'),

	// alloy requires
	_ = require('lodash'),

	// alloy compiler requires
	CompilerMakeFile = require('./CompilerMakeFile'),
	Orphanage = require('./Orphanage');

const {
	BuildLog,
	configureBabelPlugins,
	createCompileConfig,
	createCompiler,
	sourceMapper,
	utils: CU
} = require('alloy-compiler');
const {
	constants: CONST,
	logger,
	platforms,
	utils: U
} = require('alloy-utils');

var alloyRoot = path.join(__dirname, '..', '..'),
	viewRegex = new RegExp('\\.' + CONST.FILE_EXT.VIEW + '$'),
	controllerRegex = new RegExp('\\.' + CONST.FILE_EXT.CONTROLLER + '$'),
	modelRegex = new RegExp('\\.' + CONST.FILE_EXT.MODEL + '$'),
	compileConfig = {},
	otherPlatforms,
	buildPlatform,
	titaniumFolder,
	buildLog,
	theme,
	platformTheme,
	widgetIds = [],
	compiler;

var times = {
	first: null,
	last: null,
	msgs: []
};

var fileRestrictionUpdatedFiles = [],
	restrictionSkipOptimize = false;

//////////////////////////////////////
////////// command function //////////
//////////////////////////////////////
module.exports = function(args, program) {
	BENCHMARK();
	var alloyConfig = {},
		compilerMakeFile,
		restrictionPath,

		// NOTE: the following line creates the empty Resources/app.js file
		paths = U.getAndValidateProjectPaths(
			program.outputPath || args[0] || process.cwd()
		);

	// Initialize modules used throughout the compile process
	buildLog = new BuildLog(paths.project);

	// construct compiler config from command line config parameters
	// and print the configuration data
	logger.debug('----- CONFIGURATION -----');
	if (program.config && _.isString(program.config)) {
		logger.debug('raw config = "' + program.config + '"');
		_.each(program.config.split(','), function(v) {
			var parts = v.split('=');
			if (alloyConfig[parts[0]]) {
				alloyConfig[parts[0]] = [].concat(alloyConfig[parts[0]], parts[1]);
			} else {
				alloyConfig[parts[0]] = parts[1];
			}
			logger.debug(parts[0] + ' = ' + parts[1]);
		});
	}
	if (program.platform) {
		logger.debug('platform = ' + program.platform);
		alloyConfig.platform = program.platform;
	}
	if (!alloyConfig.deploytype) {
		alloyConfig.deploytype = 'development';
		logger.debug('deploytype = ' + alloyConfig.deploytype);
	}
	logger.debug('project path = ' + paths.project);
	logger.debug('app path = ' + paths.app);
	logger.debug('');

	// make sure a platform was specified
	buildPlatform = alloyConfig.platform;
	if (!buildPlatform) {
		U.die([
			'You must define a target platform for the alloy compile command',
			'  Ex. "alloy compile --config platform=ios"'
		]);
	}
	titaniumFolder = platforms[buildPlatform].titaniumFolder;
	otherPlatforms = _.without(platforms.constants.PLATFORM_FOLDERS, titaniumFolder);

	// check the platform and i18n to see if it was generated by us last time
	var destI18NDir = path.join(paths.project, 'i18n');
	var destPlatformDir = path.join(paths.project, 'platform', buildPlatform === 'iphone' ? 'ios' : buildPlatform);
	if (fs.existsSync(destI18NDir) && !fs.existsSync(path.join(destI18NDir, 'alloy_generated'))) {
		U.die([
			'Detected legacy "/i18n" directory in project directory.',
			'Please move the "/i18n" directory to "/app/i18n" for Alloy 1.8.0 or later.'
		]);
	}
	if (fs.existsSync(destPlatformDir) && !fs.existsSync(path.join(destPlatformDir, 'alloy_generated'))) {
		U.die([
			'Detected legacy "/platform" directory in project directory.',
			'Please move the "/platform" directory to "/app/platform" for Alloy 1.8.0 or later.'
		]);
	}

	// check that the .gitignore is looking good
	var gitignoreFile = path.join(paths.project, '.gitignore');
	if (fs.existsSync(gitignoreFile)) {
		var folders = {
			'/i18n': false,
			'/platform': false,
			'/Resources': false
		};
		fs.readFileSync(gitignoreFile).toString().split('\n').forEach(function (line) {
			line = line.trim();
			if (/^\/?i18n(\/.*)?$/.test(line)) {
				folders['/i18n'] = true;
			} else if (/^\/?platform(\/.*)?$/.test(line)) {
				folders['/platform'] = true;
			} else if (/^\/?Resources(\/.*)?$/.test(line)) {
				folders['/Resources'] = true;
			}
		});
		var warned = false;
		Object.keys(folders).some(function (dir) {
			if (!folders[dir]) {
				logger.warn('Generated "' + dir + '" directory is not ignored by Git, please add it to your .gitignore');
				warned = true;
			}
		});
		warned && logger.debug();
	}

	// allow to filter the file to compile
	if (!alloyConfig.file) {
		restrictionPath = null;
	} else {
		restrictionPath = _.map([].concat(alloyConfig.file), function (file) {
			return path.join(paths.project, file);
		});
	}

	// create compile config from paths and various alloy config files
	logger.debug('----- CONFIG.JSON -----');
	compileConfig = createCompileConfig({
		projectDir: paths.project,
		buildLog,
		alloyConfig,
		logLevel: logger.TRACE
	});
	theme = compileConfig.theme;
	platformTheme = buildLog.data[buildPlatform] ? buildLog.data[buildPlatform]['theme'] : '';

	buildLog.data.themeChanged = theme !== platformTheme;
	buildLog.data.theme = theme;
	// track whether deploy type has changed since previous build
	buildLog.data.deploytypeChanged = buildLog.data.deploytype !== alloyConfig.deploytype;
	buildLog.data.deploytype = alloyConfig.deploytype;
	logger.debug('');

	// wipe the controllers, models, and widgets
	logger.debug('----- CLEANING RESOURCES -----');
	var orphanage = new Orphanage(paths.project, buildPlatform, {
		theme: theme,
		adapters: compileConfig.adapters
	});
	orphanage.clean();
	logger.debug('');

	// process project makefiles
	compilerMakeFile = new CompilerMakeFile();
	var alloyJMK = path.resolve(path.join(paths.app, 'alloy.jmk'));
	if (fs.existsSync(alloyJMK)) {
		logger.debug('Loading "alloy.jmk" compiler hooks...');
		var script = vm.createScript(fs.readFileSync(alloyJMK), 'alloy.jmk');

		// process alloy.jmk compile file
		try {
			script.runInNewContext(compilerMakeFile);
			compilerMakeFile.isActive = true;
		} catch (e) {
			logger.error(e.stack);
			U.die('Project build at "' + alloyJMK + '" generated an error during load.');
		}

		compilerMakeFile.trigger('pre:load', _.clone(compileConfig));
		logger.debug('');
	}

	// create generated controllers folder in resources
	logger.debug('----- BASE RUNTIME FILES -----');
	U.installPlugin(path.join(alloyRoot, '..'), paths.project);

	// copy in all lib resources from alloy module, exclude backbone dir
	updateFilesWithBuildLog(
		path.join(alloyRoot, 'lib'),
		path.join(paths.resources, titaniumFolder),
		{
			rootDir: paths.project,
			filter: new RegExp('^alloy[\\/\\\\]backbone([\\/\\\\]|$)'),
			exceptions: _.map(_.difference(CONST.ADAPTERS, compileConfig.adapters), function(a) {
				return path.join('alloy', 'sync', a + '.js');
			}),
			restrictionPath: restrictionPath
		}
	);

	// Copy the version of backbone that is specified in config.json
	U.copyFileSync(
		path.join(
			alloyRoot, 'lib', 'alloy', 'backbone',
			(_.includes(CONST.SUPPORTED_BACKBONE_VERSIONS, compileConfig.backbone))
				? compileConfig.backbone
				: CONST.DEFAULT_BACKBONE_VERSION,
			'backbone.js'
		),
		path.join(paths.resources, titaniumFolder, 'alloy', 'backbone.js')
	);

	if (restrictionPath === null) {
		// Generate alloy.js from template
		var libAlloyJsDest = path.join(paths.resources, titaniumFolder, 'alloy.js');
		logger.trace('Generating ' + path.relative(titaniumFolder, libAlloyJsDest).yellow);
		fs.writeFileSync(
			libAlloyJsDest,
			ejs.render(
				fs.readFileSync(path.join(alloyRoot, 'template', 'lib', 'alloy.js'), 'utf8'),
				{ version: program.version() }
			)
		);
	}

	// NOTE: copies `alloy-utils/lib/constants.js` into `<project-dir>/Resources/<platform>/alloy`
	U.copyFileSync(
		path.join(path.dirname(require.resolve('alloy-utils')), 'constants.js'),
		path.join(paths.resources, titaniumFolder, 'alloy', 'constants.js')
	);

	// create runtime folder structure for alloy
	_.each(['COMPONENT', 'WIDGET', 'RUNTIME_STYLE'], function(type) {
		var p = path.join(paths.resources, titaniumFolder, 'alloy', CONST.DIR[type]);
		fs.mkdirpSync(p);
		chmodr.sync(p, 0755);
	});

	// Copy in all developer assets, libs, and additional resources
	_.each(['ASSETS', 'LIB', 'VENDOR'], function(type) {
		updateFilesWithBuildLog(
			path.join(paths.app, CONST.DIR[type]),
			path.join(paths.resources, titaniumFolder),
			{
				rootDir: paths.project,
				themeChanged: buildLog.data.themeChanged,
				filter: new RegExp('^(?:' + otherPlatforms.join('|') + ')[\\/\\\\]'),
				exceptions: otherPlatforms,
				createSourceMap: (type === 'ASSETS') ? false : compileConfig.sourcemap,
				compileConfig: compileConfig,
				titaniumFolder: titaniumFolder,
				type: type,
				restrictionPath: restrictionPath
			}
		);
	});

	// copy in test specs if not in production
	if (alloyConfig.deploytype !== 'production') {
		updateFilesWithBuildLog(
			path.join(paths.app, 'specs'),
			path.join(paths.resources, titaniumFolder, 'specs'),
			{ rootDir: paths.project, restrictionPath: restrictionPath }
		);
	}

	var defaultIcons = ['DefaultIcon.png', 'DefaultIcon-' + buildPlatform + '.png'];

	// check theme for assets
	if (theme) {
		_.each(['ASSETS', 'LIB', 'VENDOR'], function(type) {
			var themeAssetsPath = path.join(paths.app, 'themes', theme, CONST.DIR[type]);
			if (fs.existsSync(themeAssetsPath)) {
				updateFilesWithBuildLog(
					themeAssetsPath,
					path.join(paths.resources, titaniumFolder),
					{
						rootDir: paths.project,
						themeChanged: buildLog.data.themeChanged,
						filter: new RegExp('^(?:' + otherPlatforms.join('|') + ')[\\/\\\\]'),
						exceptions: otherPlatforms,
						titaniumFolder: titaniumFolder,
						restrictionPath: restrictionPath
					}
				);
			}
		});

		// This is not ideal, but until the build system allows icons to be picked up in another location,
		// we need to do this for now.
		defaultIcons.forEach(function (file) {
			var themeIconFile = path.join(paths.app, 'themes', theme, file);
			var projectIconFile = path.join(paths.project, file);
			var appcDirIconFile = path.join(paths.app, file);

			if (fs.existsSync(themeIconFile)) {
				if (fs.existsSync(projectIconFile) && !fs.existsSync(appcDirIconFile)) {
					// 1st time theming defaulticon, copy icon file from root to app dir
					logger.debug('Use themed DefaultIcon, make a copy of the DefaultIcon file in app folder.');
					logger.debug('Moving ' + projectIconFile.yellow + ' --> ' + appcDirIconFile.yellow);
					U.copyFileSync(projectIconFile, appcDirIconFile);
				}

				logger.debug('Use themed DefaultIcon.');
				logger.debug('Copying ' + themeIconFile.yellow + ' --> ' + projectIconFile.yellow);
				fs.copySync(themeIconFile, projectIconFile, { preserveTimestamps: true });
			}
		});

	} else {
		defaultIcons.forEach(function (file) {
			var src = path.join(paths.app, file);
			var dest = path.join(paths.project, file);
			if (fs.existsSync(src))  {
				logger.debug('Copying ' + src.yellow + ' --> ' + dest.yellow);
				fs.copySync(src, dest, { preserveTimestamps: true });
			}
		});
	}

	function generateMessage(dir) {
		return 'This directory is generated from the "/app/' + dir + '" and "/app/theme/<name>/' + dir + '" directories.\n\n' +
			'Do not modify any files in this directory. Your changes will be lost on next build.\n\n' +
			'Please make sure "/' + dir + '" is added to your version control\'s ignore list (i.e. .gitignore).';
	}

	// copy the platform and theme platform directories
	var sourcePlatformDirs;
	if (buildPlatform === 'ios' || buildPlatform === 'iphone') {
		sourcePlatformDirs = [ 'platform/iphone', 'platform/ios' ];
		var iPhonePlatformDir = path.join(paths.project, 'platform', 'iphone');
		if (fs.existsSync(iPhonePlatformDir)) {
			logger.trace('Deleting ' + iPhonePlatformDir.yellow);
			fs.removeSync(iPhonePlatformDir);
		}
	} else {
		sourcePlatformDirs = [ 'platform/' + buildPlatform ];
	}
	if (fs.existsSync(destPlatformDir)) {
		logger.debug('Resetting ' + destPlatformDir.yellow);
		fs.removeSync(destPlatformDir);
	}
	fs.mkdirpSync(destPlatformDir);
	chmodr.sync(destPlatformDir, 0755);
	fs.writeFileSync(path.join(destPlatformDir, 'alloy_generated'), generateMessage('platform'));
	sourcePlatformDirs.forEach(function (dir) {
		var dirs = [ dir ];
		theme && dirs.push('themes/' + theme + '/' + dir);
		dirs.forEach(function (dir) {
			dir = path.join(paths.app, dir);
			if (fs.existsSync(dir)) {
				logger.debug('Copying ' + dir.yellow + ' --> ' + destPlatformDir.yellow);
				fs.copySync(dir, destPlatformDir, { preserveTimestamps: true });
			}
		});
	});
	logger.debug('');

	// copy the i18n and i18n platform directories
	var sourceI18NPaths = [ path.join(paths.app, 'i18n') ];
	if (theme) {
		sourceI18NPaths.push(path.join(paths.app, 'themes', theme, 'i18n'));
	}
	if (fs.existsSync(destI18NDir)) {
		logger.debug('Resetting ' + destI18NDir.yellow);
		fs.removeSync(destI18NDir);
	}
	fs.mkdirpSync(destI18NDir);
	chmodr.sync(destI18NDir, 0755);
	fs.writeFileSync(path.join(destI18NDir, 'alloy_generated'), generateMessage('i18n'));
	sourceI18NPaths.forEach(function (dir) {
		if (fs.existsSync(dir)) {
			CU.mergeI18N(dir, destI18NDir, { override: true });
		}
	});
	logger.debug('');

	// trigger our custom compiler makefile
	if (compilerMakeFile.isActive) {
		compilerMakeFile.trigger('pre:compile', _.clone(compileConfig));
	}

	logger.info('----- MVC GENERATION -----');

	compiler = createCompiler({ compileConfig });

	// Create collection of all widget and app paths
	var widgetDirs = U.getWidgetDirectories(paths.app);
	widgetDirs.push({ dir: path.join(paths.project, CONST.ALLOY_DIR) });

	// Process all models
	var models = processModels(widgetDirs);
	_.each(models, function(m) {
		CU.models.push(m);
	});

	// Create a regex for determining which platform-specific
	// folders should be used in the compile process
	var filteredPlatforms = _.reject(platforms.constants.PLATFORM_FOLDERS_ALLOY, function(p) {
		return p === buildPlatform;
	});
	filteredPlatforms = _.map(filteredPlatforms, function(p) { return p + '[\\\\\\/]'; });
	var filterRegex = new RegExp('^(?:(?!' + filteredPlatforms.join('|') + '))');

	// don't process XML/controller files inside .svn folders (ALOY-839)
	var excludeRegex = new RegExp('(?:^|[\\/\\\\])(?:' + CONST.EXCLUDED_FILES.join('|') + ')(?:$|[\\/\\\\])');

	// Process all views/controllers and generate their runtime
	// commonjs modules and source maps.
	var tracker = {};
	_.each(widgetDirs, function(collection) {
		// generate runtime controllers from views
		var theViewDir = path.join(collection.dir, CONST.DIR.VIEW);
		if (fs.existsSync(theViewDir)) {
			_.each(walkSync(theViewDir), function(view) {
				view = path.normalize(view);
				if (viewRegex.test(view) && filterRegex.test(view) && !excludeRegex.test(view)) {
					// make sure this controller is only generated once
					var theFile = view.substring(0, view.lastIndexOf('.'));
					var theKey = theFile.replace(new RegExp('^' + buildPlatform + '[\\/\\\\]'), '');
					var fp = path.join(collection.dir, theKey);
					if (tracker[fp]) { return; }

					// generate runtime controller
					logger.info('[' + view + '] ' + (collection.manifest ? collection.manifest.id +
						' ' : '') + 'view processing...');
					parseAlloyComponent(view, collection.dir, collection.manifest, null, restrictionPath);
					tracker[fp] = true;
				}
			});
		}

		// generate runtime controllers from any controller code that has no
		// corresponding view markup
		var theControllerDir = path.join(collection.dir, CONST.DIR.CONTROLLER);
		if (fs.existsSync(theControllerDir)) {
			_.each(walkSync(theControllerDir), function(controller) {
				controller = path.normalize(controller);
				if (controllerRegex.test(controller) && filterRegex.test(controller) && !excludeRegex.test(controller)) {
					// make sure this controller is only generated once
					var theFile = controller.substring(0, controller.lastIndexOf('.'));
					var theKey = theFile.replace(new RegExp('^' + buildPlatform + '[\\/\\\\]'), '');
					var fp = path.join(collection.dir, theKey);
					if (tracker[fp]) { return; }

					// generate runtime controller
					logger.info('[' + controller + '] ' + (collection.manifest ?
						collection.manifest.id + ' ' : '') + 'controller processing...');
					parseAlloyComponent(controller, collection.dir, collection.manifest, true, restrictionPath);
					tracker[fp] = true;
				}
			});
		}
	});
	logger.info('');

	generateAppJs(paths, compileConfig, restrictionPath, compilerMakeFile);

	// optimize code
	logger.info('----- OPTIMIZING -----');

	if (restrictionSkipOptimize) {
		logger.info('Skipping optimize due to file restriction.');
	} else {
		optimizeCompiledCode(alloyConfig, paths);
	}

	// trigger our custom compiler makefile
	if (compilerMakeFile.isActive) {
		compilerMakeFile.trigger('post:compile', _.clone(compileConfig));
	}

	// write out the log for this build
	buildLog.write();

	BENCHMARK('TOTAL', true);
};


///////////////////////////////////////
////////// private functions //////////
///////////////////////////////////////
function generateAppJs(paths, compileConfig, restrictionPath, compilerMakeFile) {
	var alloyJs = path.join(paths.app, 'alloy.js');

	if (restrictionPath !== null && !_.includes(restrictionPath, path.join(paths.app, 'alloy.js')) ) {
		// skip alloy.js processing when filtering on another file
		return;
	}

	// info needed to generate app.js
	var target = {
			filename: path.join('Resources', titaniumFolder, 'app.js'),
			filepath: path.join(paths.resources, titaniumFolder, 'app.js'),
			template: path.join(alloyRoot, 'template', 'app.js')
		},

		// additional data used for source mapping
		data = {
			'__MAPMARKER_ALLOY_JS__': {
				filename: 'app' + path.sep + 'alloy.js',
				filepath: alloyJs
			}
		},

		// hash used to determine if we need to rebuild
		hash = U.createHash(alloyJs);

	// is it already generated from a prior compile?
	buildLog.data[buildPlatform] || (buildLog.data[buildPlatform] = {});
	if (!compileConfig.buildLog.data.deploytypeChanged && fs.existsSync(target.filepath) && buildLog.data[buildPlatform][alloyJs] === hash) {
		logger.info('[app.js] using cached app.js...');
		restrictionSkipOptimize = (restrictionPath !== null);

	// if not, generate the platform-specific app.js and save its hash
	} else {
		logger.info('[app.js] Titanium entry point processing...');

		// trigger our custom compiler makefile
		if (compilerMakeFile.isActive) {
			compilerMakeFile.trigger('compile:app.js', _.clone(compileConfig));
		}

		sourceMapper.generateCodeAndSourceMap({
			target: target,
			data: data,
		}, compileConfig);
		fileRestrictionUpdatedFiles.push(path.relative('Resources', target.filename));
		buildLog.data[buildPlatform][alloyJs] = hash;
	}

	buildLog.data[buildPlatform]['theme'] = theme;
	logger.info('');
}

function matchesRestriction(files, fileRestriction) {
	var matches = false;

	_.each(files, function(file) {
		if (typeof file === 'string') {
			matches |= _.includes(fileRestriction, file);
		} else if (typeof file === 'object') {
			// platform-specific TSS files result in an object
			// with a property of platform === true which needs
			// to be removed to prevent a compile error
			delete file.platform;
			matches |= matchesRestriction(file, fileRestriction);
		} else {
			throw 'Unsupported file type: ' + typeof file;
		}
	});

	return matches;
}

function parseAlloyComponent(view, dir, manifest, noView, fileRestriction) {
	const parseType = noView ? 'controller' : 'view';
	if (!view) {
		U.die('Undefined ' + parseType + ' passed to parseAlloyComponent()');
	}
	if (!dir) {
		U.die('Failed to parse ' + parseType + ' "' + view + '", no directory given');
	}

	const meta = compiler.factory
		.createCompiler('component')
		.resolveComponentMeta(path.join(dir, `${parseType}s`, view));
	const { componentName: viewName, subPath: dirname, files } = meta;
	const { componentOutputPath, styleOutputPath } = resolveOutputPaths(viewName, dirname, manifest, files);

	fileRestriction = fileRestriction || null;
	if (fileRestriction !== null && !matchesRestriction(files, fileRestriction)) {
		logger.info('  Not matching the file restriction, skipping');
		return;
	}

	// generate component file
	const { code, map } = compiler.compileComponent({
		file: parseType === 'controller' ? files.CONTROLLER : files.VIEW
	});
	let finalCode = code;
	const relativeOutfile = path.relative(compileConfig.dir.project, componentOutputPath);
	if (compileConfig.sourcemap !== false) {
		const mapDir = path.join(compileConfig.dir.project, CONST.DIR.MAP);
		const sourceMapOutputPath = `${path.join(mapDir, relativeOutfile)}.${CONST.FILE_EXT.MAP}`;
		fs.outputFileSync(sourceMapOutputPath, map.toString());
		finalCode += `\n//# sourceMappingURL=file://${sourceMapOutputPath}`;
	}
	fs.outputFileSync(componentOutputPath, finalCode);
	logger.info(`  created:    "${relativeOutfile}"`);

	// generate runtime style file
	const styleFiles = Array.isArray(files.STYLE) ? files.STYLE : [ { file: files.STYLE } ];
	const { code: styleCode } = compiler.compileStyle(styleFiles[0]);
	fs.outputFileSync(styleOutputPath, styleCode);
	const relativeStylePath = path.relative(compileConfig.dir.project, styleOutputPath);
	logger.info(`  created:    "${relativeStylePath}"`);

	if (manifest) {
		// merge widget i18n and copy resources (but only once for every widget)
		if (widgetIds.includes(manifest.id)) {
			return;
		}
		CU.mergeI18N(path.join(dir, 'i18n'), path.join(compileConfig.dir.project, 'i18n'), { override: false });
		CU.copyWidgetResources(
			[path.join(dir, CONST.DIR.ASSETS), path.join(dir, CONST.DIR.LIB)],
			path.join(compileConfig.dir.resources, titaniumFolder),
			manifest.id,
			{
				filter: new RegExp('^(?:' + otherPlatforms.join('|') + ')[\\/\\\\]'),
				exceptions: otherPlatforms,
				titaniumFolder: titaniumFolder,
				theme: theme
			}
		);
		widgetIds.push(manifest.id);
	}
}

/**
 * Resolve the output paths based on whether it's an app controller or widget
 * controller.
 *
 * @param {*} view
 * @param {*} dirname
 * @param {*} manifest
 * @param {*} files
 */
function resolveOutputPaths(viewName, dirname, manifest, files) {
	var componentOutputPath = path.join(compileConfig.dir.resources, titaniumFolder,
		path.relative(compileConfig.dir.resources, files.COMPONENT));
	var styleOutputPath = path.join(compileConfig.dir.resources, titaniumFolder,
		path.relative(compileConfig.dir.resources, files.RUNTIME_STYLE));
	if (manifest) {
		const widgetDir = dirname ? path.join(CONST.DIR.COMPONENT, dirname) : CONST.DIR.COMPONENT;
		const widgetStyleDir = dirname
			? path.join(CONST.DIR.RUNTIME_STYLE, dirname)
			: CONST.DIR.RUNTIME_STYLE;
		componentOutputPath = path.join(
			compileConfig.dir.resources, titaniumFolder, 'alloy', CONST.DIR.WIDGET, manifest.id,
			widgetDir, viewName + '.js'
		);
		styleOutputPath = path.join(
			compileConfig.dir.resources, titaniumFolder, 'alloy', CONST.DIR.WIDGET, manifest.id,
			widgetStyleDir, viewName + '.js'
		);
	}

	return {
		componentOutputPath,
		styleOutputPath
	};
}

function findModelMigrations(name, inDir) {
	try {
		var migrationsDir = inDir || compileConfig.dir.migrations;
		var files = fs.readdirSync(migrationsDir);
		var part = '_' + name + '.' + CONST.FILE_EXT.MIGRATION;

		// look for our model
		files = _.reject(files, function(f) { return f.indexOf(part) === -1; });

		// sort them in the oldest order first
		files = files.sort(function(a, b) {
			var x = a.substring(0, a.length - part.length - 1);
			var y = b.substring(0, b.length - part.length - 1);
			if (x < y) { return -1; }
			if (x > y) { return 1; }
			return 0;
		});

		var codes = [];
		_.each(files, function(f) {
			var mf = path.join(migrationsDir, f);
			var m = fs.readFileSync(mf, 'utf8');
			var code = '(function(migration){\n ' +
				"migration.name = '" + name + "';\n" +
				"migration.id = '" + f.substring(0, f.length - part.length).replace(/_/g, '') + "';\n" +
				m +
				'})';
			codes.push(code);
		});
		logger.info('Found ' + codes.length + ' migrations for model: ' + name);
		return codes;
	} catch (E) {
		return [];
	}
}

function processModels(dirs) {
	var models = [];
	var modelTemplateFile = path.join(alloyRoot, 'template', 'model.js');

	_.each(dirs, function(dirObj) {
		var modelDir = path.join(dirObj.dir, CONST.DIR.MODEL);
		if (!fs.existsSync(modelDir)) {
			return;
		}

		var migrationDir = path.join(dirObj.dir, CONST.DIR.MIGRATION);
		var manifest = dirObj.manifest;
		var isWidget = typeof manifest !== 'undefined' && manifest !== null;
		var pathPrefix = isWidget ? 'widgets/' + manifest.id + '/' : '';
		_.each(fs.readdirSync(modelDir), function(file) {
			if (!modelRegex.test(file)) {
				logger.warn('Non-model file "' + file + '" in ' + pathPrefix + 'models directory');
				return;
			}
			logger.info('[' + pathPrefix + 'models/' + file + '] model processing...');

			var fullpath = path.join(modelDir, file);
			var basename = path.basename(fullpath, '.' + CONST.FILE_EXT.MODEL);

			// generate model code based on model.js template and migrations
			var code = _.template(fs.readFileSync(modelTemplateFile, 'utf8'))({
				basename: basename,
				modelJs: fs.readFileSync(fullpath, 'utf8'),
				migrations: findModelMigrations(basename, migrationDir)
			});

			// write the model to the runtime file
			var casedBasename = U.properCase(basename);
			var modelRuntimeDir = path.join(compileConfig.dir.resources,
				titaniumFolder, 'alloy', 'models');
			if (isWidget) {
				modelRuntimeDir = path.join(compileConfig.dir.resources,
					titaniumFolder, 'alloy', 'widgets', manifest.id, 'models');
			}
			fs.mkdirpSync(modelRuntimeDir);
			chmodr.sync(modelRuntimeDir, 0755);
			fs.writeFileSync(path.join(modelRuntimeDir, casedBasename + '.js'), code);
			models.push(basename);
		});
	});

	return models;
}

function updateFilesWithBuildLog(src, dst, opts) {
	// filter on retrictionPath
	if (opts.restrictionPath === null || _.find(opts.restrictionPath, function(f) {return f.indexOf(src) === 0;})) {
		var updatedFiles = CU.updateFiles(src, dst, _.extend({ isNew: buildLog.isNew }, opts));

		if (typeof updatedFiles == 'object' && updatedFiles.length > 0 && opts.restrictionPath !== null) {
			fileRestrictionUpdatedFiles = _.union(fileRestrictionUpdatedFiles, updatedFiles);
		}
	}
}

function optimizeCompiledCode(alloyConfig, paths) {
	var lastFiles = [],
		files;

	// Get the list of JS files from the Resources directory
	// and exclude files that don't need to be optimized, or
	// have already been optimized.
	function getJsFiles() {
		if (alloyConfig.file && (fileRestrictionUpdatedFiles.length > 0)) {
			logger.info('Restricting optimize on file(s) : ' + fileRestrictionUpdatedFiles.join(', '));
			return fileRestrictionUpdatedFiles;
		}

		var exceptions = [
			'app.js',
			'alloy/CFG.js',
			'alloy/controllers/',
			'alloy/styles/',
			'alloy/backbone.js',
			'alloy/constants.js',
			'alloy/underscore.js',
			'alloy/widget.js'
		].concat(compileConfig.optimizingExceptions || []);

		// widget controllers are already optimized. It should be listed in exceptions.
		_.each(compileConfig.dependencies, function (version, widgetName) {
			exceptions.push('alloy/widgets/' + widgetName + '/controllers/');
		});

		_.each(exceptions.slice(0), function(ex) {
			exceptions.push(`${titaniumFolder}/${ex}`);
		});

		var excludePatterns = otherPlatforms.concat(['.+node_modules']);
		var rx = new RegExp('^(?!' + excludePatterns.join('|') + ').+\\.js$');
		return _.filter(walkSync(compileConfig.dir.resources), function(f) {
			return rx.test(f) && !_.find(exceptions, function(e) {
				return f.indexOf(e) === 0;
			}) && !fs.statSync(path.join(compileConfig.dir.resources, f)).isDirectory();
		});
	}

	// TODO: Remove once @titanium-sdk/babel-preset-app is in place
	while ((files = _.difference(getJsFiles(), lastFiles)).length > 0) {
		_.each(files, function(file) {
			var options = _.extend(_.clone(sourceMapper.OPTIONS_OUTPUT), {
					plugins: configureBabelPlugins(compileConfig)
				}),
				fullpath = path.join(compileConfig.dir.resources, file);

			logger.info('- ' + file);
			try {
				var result = babel.transformFileSync(fullpath, options);
				fs.writeFileSync(fullpath, result.code);
			} catch (e) {
				U.die(`Error transforming JS file ${fullpath}`, e);
			}
		});
		lastFiles = _.union(lastFiles, files);
	}
}

function BENCHMARK(desc, isFinished) {
	var places = Math.pow(10, 5);
	desc = desc || '<no description>';
	if (times.first === null) {
		times.first = process.hrtime();
		return;
	}

	function hrtimeInSeconds(t) {
		return t[0] + (t[1] / 1000000000);
	}

	var total = process.hrtime(times.first);
	var current = hrtimeInSeconds(total) - (times.last ? hrtimeInSeconds(times.last) : 0);
	times.last = total;
	var thisTime = Math.round((isFinished ? hrtimeInSeconds(total) : current) * places) / places;
	times.msgs.push('[' + thisTime + 's] ' + desc);
	if (isFinished) {
		logger.trace(' ');
		logger.trace('Benchmarking');
		logger.trace('------------');
		logger.trace(times.msgs);
		logger.info('');
		logger.info('Alloy compiled in ' + thisTime + 's');
	}
}
