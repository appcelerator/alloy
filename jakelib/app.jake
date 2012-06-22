var fs = require('fs'),
	path = require('path'),
	wrench = require('wrench'),
	spawn = require('child_process').spawn,
	targetAppPath = path.join(process.cwd(),'test','projects','Harness','app');

namespace('app', function() {
	desc('remove the contents of the test harness\' "app" directory');
	task('clobber', function() {
		console.log('clobbering Alloy app directory...');
		if (path.existsSync(targetAppPath)) {
			wrench.rmdirSyncRecursive(targetAppPath);
		}
		fs.mkdirSync(targetAppPath);
	});
	
	desc('compile the example app in the given directory name and stage for launch, e.g. "jake app:setup dir=masterdetail"');
	task('setup', ['app:clobber'], function() {
		var templateDir = path.join(targetAppPath,'template');

		console.log('Staging sample app "'+process.env.dir+'" for launch...');
		wrench.copyDirSyncRecursive(process.cwd()+'/test/apps/'+process.env.dir, targetAppPath);

		console.log('Copying Alloy templates...');
		if (path.existsSync(templateDir)) {
			wrench.rmdirSyncRecursive(templateDir);
		}
		wrench.mkdirSyncRecursive(templateDir, 0777);
		wrench.copyDirSyncRecursive(process.cwd()+'/Alloy/template', templateDir);
	});
	
	desc('run the example app in the given directory name, with optional platform, e.g. "jake app:run dir=masterdetail platform=android"');
	task('run', ['app:setup'], function() {
		var sdkRoot = process.env.TITANIUM_MOBILE_SDK || process.env.sdk;
		if (!sdkRoot) {
			// attempt to locate it - at least on osx
			if (process.platform == 'darwin')
			{
				sdkRoot = path.resolve('/Library/Application Support/Titanium/mobilesdk/osx')
				if (path.existsSync(sdkRoot))
				{
					var dirs = fs.readdirSync(sdkRoot);
					if (dirs.length > 0)
					{
						// sort and get the latest if we don't pass it in
						dirs = dirs.sort();
						sdkRoot = path.join(sdkRoot, dirs[dirs.length-1]);
					}
				}
			}
		}
		if (sdkRoot) {
			console.log('Titanium Mobile SDK configured at '+sdkRoot);
			console.log('Running sample app "'+process.env.dir+'" on '+process.env.platform+'...');
			
			if (process.env.platform == 'ios')
			{
				process.env.platform = 'iphone'
			}
			
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
