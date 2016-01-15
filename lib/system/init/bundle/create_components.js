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
        logicalPath: 'internal/server/package-component-i18n-' + pkg_name + '.' + lang + '.js',
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
        logicalPath: 'internal/public/package-component-i18n-' + pkg_name + '.' + lang + '.js',
        lang,
        fallback: lang === default_lang ? null : default_lang
        // TODO: add `virtual: true` when bundler will be finished
      });
    });


    // Create views
    //
    sandbox.component_server[pkg_name].views = sandbox.bundler.createClass('concat', {
      logicalPath: 'internal/server/package-component-views-' + pkg_name + '.js',
      plugins: [ 'wrapper' ],
      wrapBefore: 'var jade = require("jade/lib/runtime");\nN.views = N.views || {};\n',
      wrapAfter: ''
      // TODO: add `virtual: true` when bundler will be finished
    });

    let client_views_plugins = [ 'wrapper' ];

    if (sandbox.N.environment !== 'development' && process.env.NODECA_NOMINIFY !== '1') {
      client_views_plugins.push('uglifyjs');
    }

    sandbox.component_client[pkg_name].views = sandbox.bundler.createClass('concat', {
      logicalPath: 'internal/public/package-component-views-' + pkg_name + '.js',
      plugins: client_views_plugins,
      wrapBefore: 'NodecaLoader.execute(function (N) {\nvar jade = N.__jade_runtime;\nN.views = N.views || {};\n',
      wrapAfter: '});'
      // TODO: add `virtual: true` when bundler will be finished
    });


    // Create js
    //
    let client_js_plugins = [];

    if (sandbox.N.environment !== 'development' && process.env.NODECA_NOMINIFY !== '1') {
      client_js_plugins.push('uglifyjs');
    }

    sandbox.component_client[pkg_name].js = sandbox.bundler.createClass('concat', {
      logicalPath: 'internal/public/package-component-js-' + pkg_name + '.js',
      plugins: client_js_plugins
      // TODO: add `virtual: true` when bundler will be finished
    });
  });


  callback();
};
