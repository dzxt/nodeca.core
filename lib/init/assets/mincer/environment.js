"use strict";


/*global nodeca, _*/


// stdlib
var fs   = require('fs');
var path = require('path');


// 3rd-party
var Mincer = require('mincer');
var JASON  = require('nlib').Vendor.JASON;


// NLib
var HashTree = require('nlib').Support.HashTree;


// internal
var compression = require('./compression');


////////////////////////////////////////////////////////////////////////////////


// configure(root) -> Mincer.Environment
// - root (String): Root pathname of the environment
//
// Preconfigures Mincer environment
//
function configure(root) {
  var environment = new Mincer.Environment(root);

  //
  // Provide some helpers to EJS and Stylus
  //

  environment.registerHelper({
    asset_path: function (pathname) {
      var asset = environment.findAsset(pathname);
      return !asset ? null : ("/assets/" + asset.digestPath);
    },
    nodeca: function (path) {
      return HashTree.get(nodeca, path);
    },
    jason: JASON.stringify
  });

  //
  // fill in 3rd-party modules paths
  //

  environment.appendPath(path.resolve(__dirname, '../../../../node_modules/faye/browser'));
  environment.appendPath(path.resolve(__dirname, '../../../../../nlib/node_modules/pointer/browser'));
  environment.appendPath(path.resolve(__dirname, '../../../../../nlib/node_modules/babelfish/browser'));

  //
  // fill in base assets (non-themable) of all apps
  //

  _.each(nodeca.runtime.apps, function (app) {
    environment.appendPath(path.join(app.root, 'assets/javascripts'));
    environment.appendPath(path.join(app.root, 'assets/stylesheets'));
    environment.appendPath(path.join(app.root, 'assets/vendor'));
  });

  //
  // fill in paths relative to the `root` for localized/skinned/etc. assets
  //

  environment.appendPath('assets');
  environment.appendPath('bundle');
  environment.appendPath('system');
  environment.appendPath('compiled');

  //
  // Set JS/CSS compression if it was not explicitly disabled
  // USAGE: SKIP_ASSETS_COMPRESSION=1 ./nodeca.js server
  //

  if (!process.env.SKIP_ASSETS_COMPRESSION) {
    environment.jsCompressor  = compression.js;
    environment.cssCompressor = compression.css;
  }

  return environment;
}


////////////////////////////////////////////////////////////////////////////////


module.exports.configure = configure;
