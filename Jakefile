var fs = require('fs'),
	path = require('path'),
	wrench = require('wrench'),
	spawn = require('child_process').spawn;

desc('Default task - prompt to print this listing');
task('default', function() {
	console.log('Run "jake -T" for a listing of available tasks');
});

namespace('app', function() {
	desc('remove the contents of the test harness\' "app" directory');
	task('clobber', function() {
		console.log('clobbering Alloy app directory...');
		var appDir = process.cwd()+'/test/projects/Harness/app';
		if (path.existsSync(appDir)) {
			wrench.rmdirSyncRecursive(appDir);
		}
		fs.mkdirSync(process.cwd()+'/test/projects/Harness/app');
	});
	
	desc('compile the example app in the given directory name and stage for launch, e.g. "jake app:setup dir=master_detail"');
	task('setup', ['app:clobber'], function() {
		console.log('Staging sample app "'+process.env.dir+'" for launch...');
		wrench.copyDirSyncRecursive(process.cwd()+'/test/apps/'+process.env.dir, process.cwd()+'/test/projects/Harness/app');
	});
	
	desc('run the example app in the given directory name, with optional platform, e.g. "jake app:run dir=master_detail platform=android"');
	task('run', ['app:setup'], function() {
		var sdkRoot = process.env.TITANIUM_MOBILE_SDK || process.env.sdk;
		if (sdkRoot) {
			console.log('Titanium Mobile SDK configured at '+sdkRoot);
			console.log('Running sample app "'+process.env.dir+'" on '+process.env.platform+'...');
			
			//run the project using titanium.py
			var runcmd = spawn('python', [
				sdkRoot+'/titanium.py',
				'run',
				'--dir='+process.cwd()+'/test/projects/Harness',
				'--platform='+process.env.platform
			],process.env);
			
			//run stdout/stderr back through console.log
			runcmd.stdout.on('data', function (data) {
				console.log(String(data));
			});

			runcmd.stderr.on('data', function (data) {
			  	console.log(String(data));
			});

			runcmd.on('exit', function (code) {
			  	console.log('Finished with code ' + code);
			});
		}
		else {
			console.log('No Mobile SDK found - configure $TITANIUM_MOBILE_SDK environment variable or pass in an "sdk" option.');
		}
	});
});