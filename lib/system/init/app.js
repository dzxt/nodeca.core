// Main application initializer. Executed as the most first step of the
// `cli/server.js` and does following:
//
//  - fetches all bin files of all packages
//  - compiles styles client trees for all packages
//  - find and read all viewws
//  - find and prepare all server methods
//  - prepares bundles client js files for all packages containing:
//    - i18n of the package
//    - client methods
//    - server methods wrapers
//    - views
//  - output bundled files into the `public/assets` dir
//  - initialize router


'use strict';


/*global N*/


// stdlib
var fs = require('fs');


// 3rd-party
var async   = require('async');
var fstools = require('fs-tools');


// internal
var readPkgConfig = require('./app/utils/read_pkg_config');
var stopwatch     = require('./app/utils/stopwatch');


////////////////////////////////////////////////////////////////////////////////


function step(name, func, tmpdir, sandbox) {
  return function (callback) {
    N.hooks.init.run(name, function (next) {
      func(tmpdir, sandbox, next);
    }, callback);
  };
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function (callback) {
  var timer = stopwatch(), tmpdir;

  // schedule files cleanup upon normal exit
  process.on('exit', function (code) {
    if (0 !== +code) {
      console.warn("Unclean exit. Bundled files left in '" + tmpdir + "'");
      return;
    }

    try {
      console.warn("Removing '" + tmpdir + "'...");
      fstools.removeSync(tmpdir);
    } catch (err) {
      console.warn("Failed remove '" + tmpdir + "'... " + String(err));
    }
  });

  try {
    // create temporary dir for styles
    tmpdir = fstools.tmpdir();
    fs.mkdirSync(tmpdir);
  } catch (err) {
    callback(err);
    return;
  }

  readPkgConfig(N.runtime.apps, function (err, config) {
    var sandbox = {};

    if (err) {
      callback(err);
      return;
    }

    sandbox.config = config;
    sandbox.assets = {
      environment:  require('./app/mincer').init(tmpdir, config, N.runtime.apps),
      // holds list of assets to be bundled by mincer
      files:        []
    };

    N.hooks.init.run('application', function (next) {
      async.series([
        step('bin-section',     require('./app/bin'),     tmpdir, sandbox),
        step('styles-section',  require('./app/styles'),  tmpdir, sandbox),
        step('i18n-section',    require('./app/i18n'),    tmpdir, sandbox),
        step('views-section',   require('./app/views'),   tmpdir, sandbox),
        step('client-section',  require('./app/client'),  tmpdir, sandbox),
        step('server-section',  require('./app/server'),  tmpdir, sandbox),
        step('bundle',          require('./app/bundle'),  tmpdir, sandbox),
        step('router',          require('./app/router'),  tmpdir, sandbox)
      ], function (err) {
        N.logger.debug('App initialized ' + timer.elapsed);
        next(err);
      });
    }, callback);
  });
};
