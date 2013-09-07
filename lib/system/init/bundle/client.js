// `client` section processor
//


'use strict';


// stdlib
var fs    = require('fs');
var path  = require('path');


// 3rd-party
var _            = require('lodash');
var ejs          = require('ejs');
var fstools      = require('fs-tools');
var findRequires = require('find-requires');


// internal
var stopwatch         = require('../utils/stopwatch');
var resolveModulePath = require('./utils/resolve_module_path');
var jetson            = require('../../jetson');
var findPaths         = require('./utils/find_paths');


////////////////////////////////////////////////////////////////////////////////


var WRAPPER_CLIENT_TEMPLATE_PATH = path.join(__dirname, 'client', 'wrapper_client.tpl');
var WRAPPER_CLIENT_TEMPLATE = _.template(fs.readFileSync(WRAPPER_CLIENT_TEMPLATE_PATH, 'utf8'));

var WRAPPER_NODE_TEMPLATE_PATH = path.join(__dirname, 'client', 'wrapper_node.tpl');
var WRAPPER_NODE_TEMPLATE = _.template(fs.readFileSync(WRAPPER_NODE_TEMPLATE_PATH, 'utf8'));


// Contains full list of bundled modules (files) of current sandbox.
var vendorModules;
var clientModules;

// Contains full map of vendor alias paths of current sandbox.
var vendorVirtualModules;


////////////////////////////////////////////////////////////////////////////////


// Used to detect JavaScript comments at top of a file.
// Allows to find actual code start.
var HEADER_COMMENT_PATTERN = new RegExp(
  '^(?:\\s*' +
    '(' +
      '(?:\/[*](?:\\s*|.+?)*?[*]\/)' + '|' +
      '(?:\/\/.*\n?)+' +
    ')*' +
  '\\s*)*', 'm');


// Wraps the given source code string as a module definition for the client.
// Recursively browserifies and embeds all of unbundled dependencies.
function browserifySingle(sandbox, pkgName, source, options) {
  var result       = []
    , N            = sandbox.N
    , embeddedModulesPaths   = sandbox.embeddedModulesPaths
    , dontWrap     = options.dontWrap    || false
    , wrapper      = options.clientModule ? WRAPPER_CLIENT_TEMPLATE : WRAPPER_NODE_TEMPLATE
    , apiPath      = options.apiPath     || null
    , filePath       = options.fsPath
    , directory    = path.dirname(filePath)
    , commentMatch = HEADER_COMMENT_PATTERN.exec(source);

  if (!filePath) {
    throw new Error('Missed required `fsPath` argument.');
  }

  // Embedded modules must be placed *after* Mincer's comment directives.
  if (commentMatch) {
    result.push(source.slice(0, commentMatch[0].length));
    source = source.slice(commentMatch[0].length);
  }

  // If target file is an EJS template, render it before any processing.
  if (options.allowEJS && '.ejs' === path.extname(filePath)) {
    source = ejs.render(source, { N: N, jetson: jetson.serialize });
  }

  // Look for:
  // - Requires of "foreign", unbundled modules.
  // - Node package-relative requires. Such as `require("nodeca.core/something")`
  findRequires(source, { raw: true }).forEach(function (match) {
    var resolvedPath, dependencySource;

    // `require` path cannot be determinated - throw error.
    if (!match.value) {
      throw new Error("Error in 'require': file '" + filePath + "', string " + match.line + '.');
    }

    if (vendorVirtualModules[match.value]) {
      // Get path to a virtual module.
      resolvedPath = vendorVirtualModules[match.value];
    } else {
      // Resolve absolute, relative, or node-module path.
      resolvedPath = resolveModulePath(directory, match.value);
    }

    if (!resolvedPath) {
      throw 'Bundler cannot find required file "' + match.value + '" ' +
            'at ' + filePath + ':' + match.point + ':' + match.line;
    }

    if (_.contains(clientModules, resolvedPath)) {
      throw 'Require of client block "' + match.value + '" is prohibited ' +
            'at ' + filePath + ':' + match.point + ':' + match.line;
    }

    // FIXME: This is not actually safe way to replace require paths, but
    // alternative ways seem be too complicated.
    source = source.replace(match.raw, JSON.stringify(resolvedPath));

    // Embed private local modules. (not described in the bundle config and
    // not embedded yet)
    if (!_.contains(vendorModules, resolvedPath) &&
        !_.contains(embeddedModulesPaths[pkgName], resolvedPath)) {

      embeddedModulesPaths[pkgName] = embeddedModulesPaths[pkgName] || [];
      embeddedModulesPaths[pkgName].push(resolvedPath);
      dependencySource = fs.readFileSync(resolvedPath, 'utf8');

      // Recursively browserify and embed the unbundled module.
      result.push(browserifySingle(sandbox, pkgName, dependencySource, {
        clientModule: false
      , fsPath:       resolvedPath
      , allowEJS:     options.allowEJS
      , embeddedModulesPaths:   embeddedModulesPaths
      }));
    }
  });

  if (dontWrap) {
    result.push(source);
  } else {
    result.push(wrapper({
      path:    filePath  || null
    , apiPath: apiPath || null
    , source:  source
    }));
  }

  return result.join('\n');
}


// Wraps all of the given files for in-browser use and writes the result into
// the destination filepath. `files` should be an array of Pathname objects
// taken from `client` section of a package.
function browserifyFiles(sandbox, pkgName, lookup, destination) {
  var result     = [];

  // Write module definitions.
  findPaths(lookup, function (fsPath, apiPath) {
    result.push(browserifySingle(sandbox, pkgName, fs.readFileSync(fsPath, 'utf8'), {
      clientModule: true
    , fsPath:       fsPath
    , apiPath:      apiPath
    }));
  });

  // Write the result to the destination.
  fstools.mkdirSync(path.dirname(destination));
  fs.writeFileSync(destination, result.join('\n'), 'utf8');
}


function browserifyMainFile(sandbox, pkgName, filePath, destination) {
  var result = fs.readFileSync(filePath, 'utf8');

  result = browserifySingle(sandbox, pkgName, result, {
    clientModule: true
  , fsPath:       filePath
  , dontWrap:     true
  , allowEJS:     true
  });

  // Write the result to the destination.
  fstools.mkdirSync(path.dirname(destination));
  fs.writeFileSync(destination, result, 'utf8');
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function (sandbox, callback) {
  var N      = sandbox.N
    , err = null
    , timer  = stopwatch()
    , tmpdir = sandbox.tmpdir;

  //
  // Collect flat lists of all `vendor` and `client` files from all packages.
  //

  vendorModules = [];
  clientModules = [];
  vendorVirtualModules = {};

  _.forEach(sandbox.config.packages, function (pkg) {
    _.forEach(pkg.vendor[''], function (filePath) {
      vendorModules.push(filePath);
    });
  });

  _.forEach(sandbox.config.packages, function (pkg) {
    findPaths(pkg.client, function (filePath) {
      clientModules.push(filePath);
    });
  });

  _.forEach(sandbox.config.packages, function (pkg) {
    _.forEach(pkg.vendor, function (filePath, name) {
      if (name) {
        vendorVirtualModules[name] = filePath;
      }
    });
  });

  //
  // Build client files for each package
  //

  _.keys(sandbox.config.packages).forEach(function (pkgName) {
    var clientConfig = sandbox.config.packages[pkgName].client
      , mainLookup   = null
      , resultFile   = path.join(tmpdir, 'client', pkgName + '.js')
      , clientTmpDir = path.join(tmpdir, 'client', pkgName)
      , mainFile     = path.join(clientTmpDir, 'main.js')
      , modulesFile  = path.join(clientTmpDir, 'client.js')
      , targetFile   = null // mainFile if exists; modulesFile otherwise.
      , environment  = sandbox.assets.environment
      , originPaths  = environment.paths // to restore it later
      , timer        = stopwatch();

    if (_.isEmpty(clientConfig)) {
      return;
    }

    try {
      browserifyFiles(sandbox, pkgName, clientConfig, modulesFile);

      mainLookup = _.find(clientConfig, 'main');

      if (mainLookup) {
        browserifyMainFile(sandbox, pkgName, path.resolve(mainLookup.root, mainLookup.main), mainFile);
        targetFile = mainFile;
      } else {
        targetFile = modulesFile;
      }

      // Prepend path with `modulesFile` to allow use
      //
      //    //= require client
      //
      // in main file.
      environment.prependPath(clientTmpDir);

      // When Mincer is asked for a main file, it must be within roots, that
      // Mincer knows about. See: https://github.com/nodeca/mincer/issues/51
      clientConfig.forEach(function (options) {
        environment.appendPath(options.root);
      });

      // Find & build asset
      var asset = environment.findAsset(targetFile);

      // Check that main file is requirable.
      if (!asset) {
        // Restore Mincer's paths.
        environment.clearPaths();
        environment.appendPath(originPaths);

        err = 'Main client file of ' + pkgName + ' not found: ' + targetFile;
        return false;
      }

      var source = asset.buffer.toString();

      fs.writeFileSync(resultFile, source, 'utf8');
    } catch (e) {
      err = e;
      return false;
    }

    // Restore Mincer's paths.
    environment.clearPaths();
    environment.appendPath(originPaths);

    N.logger.debug('Compiled client of %s %s', pkgName, timer.elapsed);
    fstools.removeSync(clientTmpDir);
  });

  N.logger.info('Processed client section %s', timer.elapsed);
  callback(err);
};
