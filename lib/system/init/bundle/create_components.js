'use strict';


const _ = require('lodash');


module.exports = function (sandbox, callback) {

  // component_client -> <package name> -> <type> -> <lang>
  // component_server -> <package name> -> <type> -> <lang>
  //
  sandbox.component_server = {};
  sandbox.component_client = {};

  let default_lang = sandbox.N.config.locales[0];

  _.forEach(sandbox.config.packages, (pkg, pkg_name) => {
    sandbox.component_server[pkg_name] = sandbox.component_server[pkg_name] || {};
    sandbox.component_client[pkg_name] = sandbox.component_client[pkg_name] || {};
    sandbox.component_server[pkg_name].i18n = sandbox.component_server[pkg_name].i18n || {};
    sandbox.component_client[pkg_name].i18n = sandbox.component_client[pkg_name].i18n || {};

    _.forEach(sandbox.N.config.i18n, (__, lang) => {
      // Create i18n
      //
      sandbox.component_server[pkg_name].i18n[lang] = sandbox.bundler.createClass('lang', {
        logicalPath: 'server/package-component-i18n-' + pkg_name + '.' + lang + '.js',
        lang,
        fallback: lang === default_lang ? null : default_lang,
        plugins: [ 'wrapper' ],
        wrapBefore: 'N.i18n.load(',
        wrapAfter: ');'
        // TODO: add `virtual: true` when bundler will be finished
      });

      sandbox.component_client[pkg_name].i18n[lang] = sandbox.bundler.createClass('lang', {
        wrapBefore: 'NodecaLoader.execute(function (N) {\nN.i18n.load(',
        wrapAfter: ');\n});\n',
        plugins: [ 'wrapper' ],
        logicalPath: 'public/package-component-i18n-' + pkg_name + '.' + lang + '.js',
        lang,
        fallback: lang === default_lang ? null : default_lang
        // TODO: add `virtual: true` when bundler will be finished
      });
    });


    // Create views
    //
    sandbox.component_server[pkg_name].views = sandbox.bundler.createClass('concat', {
      logicalPath: 'server/package-component-views-' + pkg_name + '.js',
      plugins: [ 'wrapper' ],
      wrapBefore: 'var jade = require("jade/lib/runtime");\nN.views = N.views || {};\n',
      wrapAfter: ''
      // TODO: add `virtual: true` when bundler will be finished
    });

    sandbox.component_client[pkg_name].views = sandbox.bundler.createClass('concat', {
      logicalPath: 'public/package-component-views-' + pkg_name + '.js',
      plugins: [ 'wrapper' ],
      wrapBefore: 'NodecaLoader.execute(function (N) {\nvar jade = N.__jade_runtime;\nN.views = N.views || {};\n',
      wrapAfter: '});'
      // TODO: add `virtual: true` when bundler will be finished
    });


    // Create js
    //
    sandbox.component_client[pkg_name].js = sandbox.bundler.createClass('concat', {
      logicalPath: 'public/package-component-js-' + pkg_name + '.js'
      // TODO: add `virtual: true` when bundler will be finished
    });
  });


  callback();
};