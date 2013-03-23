// `i18n` section processor
//


'use strict';


// stdlib
var fs    = require('fs');
var path  = require('path');


// 3rd-party
var _         = require('lodash');
var BabelFish = require('babelfish');
var fstools   = require('fs-tools');


// internal
var stopwatch = require('../utils/stopwatch');
var jetson    = require('../../jetson');
var findPaths = require('./utils/find_paths');


////////////////////////////////////////////////////////////////////////////////


var WRAPPER_TEMPLATE_PATH = path.join(__dirname, 'i18n', 'wrapper.tpl');
var WRAPPER_TEMPLATE = _.template(fs.readFileSync(WRAPPER_TEMPLATE_PATH, 'utf8'));


////////////////////////////////////////////////////////////////////////////////


//  initLocalesConfig(N, knownLocales) -> Void
//  - knownLocales (Array): List of found locales.
//
//  Initialize, validate and auto-fill (if needed) N.config.locales
//
function initLocalesConfig(N, knownLocales) {
  // That's almost impossible, but can cause nasty error with default config:
  // if no translation files found - set `en-US` locale by default
  if (_.isEmpty(knownLocales)) {
    knownLocales = ['en-US'];
  }

  var localesConfig  = N.config.locales      || (N.config.locales = {})
    , enabledLocales = localesConfig.enabled || knownLocales
    , defaultLocale  = localesConfig.default || enabledLocales[0];

  if (!_.contains(enabledLocales, defaultLocale)) {
    throw new Error('Default locale <' + defaultLocale + '> must be enabled');
  }

  // reset languages configuration
  N.config.locales = {
    "default": defaultLocale,
    "enabled": enabledLocales
  };
}


////////////////////////////////////////////////////////////////////////////////


module.exports = function (sandbox) {
  var N                  = sandbox.N
    , knownLocales       = []
    , serverI18n         = new BabelFish(N.config.locales['default'])
    , clientI18n         = new BabelFish(N.config.locales['default'])
    , clientI18nPackages = []
    , tmpdir             = sandbox.tmpdir
    , timer              = stopwatch();

  function addServerI18n(locale, apiPath, phrases) {
    serverI18n.addPhrase(locale, apiPath, phrases);

    if (!_.contains(knownLocales, locale)) {
      knownLocales.push(locale);
    }
  }

  function addClientI18n(locale, pkgName, apiPath, phrases) {
    serverI18n.addPhrase(locale, apiPath, phrases);
    clientI18n.addPhrase(locale, apiPath, phrases);

    if (!_.isEmpty(phrases) && !_.contains(clientI18nPackages, pkgName)) {
      clientI18nPackages.push(pkgName);
    }

    if (!_.contains(knownLocales, locale)) {
      knownLocales.push(locale);
    }
  }

  // Collect translations of all packages (in modules tree).
  _.forEach(sandbox.config.packages, function (pkgConfig, pkgName) {

    findPaths(pkgConfig.i18n_client, function (fsPath, apiPath) {
      _.forEach(require(fsPath), function (phrases, locale) {
        addClientI18n(locale, pkgName, apiPath, phrases);
      });
    });

    findPaths(pkgConfig.i18n_server, function (fsPath, apiPath) {
      _.forEach(require(fsPath), function (phrases, locale) {
        addServerI18n(locale, apiPath, phrases);
      });
    });
  });

  // Collect global translations.
  _.forEach(N.runtime.apps, function (app) {
    var directory = path.join(app.root, 'config', 'locales');

    fstools.walkSync(directory, /\.yml$/, function (file) {
      _.forEach(require(file).i18n, function (data, locale) {
        _.forEach(data, function (phrases, pkgName) {
          addClientI18n(locale, pkgName, pkgName, phrases);
        });
      });
    });
  });


  // Write client-side i18n bundles for each package and locale.
  _.keys(sandbox.config.packages).forEach(function (pkgName) {
    var outdir = path.join(tmpdir, 'i18n', pkgName);

    fstools.mkdirSync(outdir);

    _.forEach(N.config.locales['enabled'], function (locale) {
      var result, outfile = path.join(outdir, locale + '.js');

      result = WRAPPER_TEMPLATE({
        locale: locale
      , data:   jetson.serialize(clientI18n.getCompiledData(locale))
      });

      fs.writeFileSync(outfile, result, 'utf8');
    });
  });

  // Expose server locales.
  N.runtime.i18n = serverI18n;
  initLocalesConfig(N, knownLocales);

  // Expose list of packages with client-side i18n.
  sandbox.clientI18nPackages = clientI18nPackages;

  N.logger.info('Processed i18_* sections %s', timer.elapsed);
};
