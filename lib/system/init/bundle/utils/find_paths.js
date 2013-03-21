// Search files using bundle conditions (root, include, exclude).
//


'use strict';


// stdlib
var path = require('path');


// 3rd-party
var _       = require('lodash');
var fstools = require('fs-tools');


// internal
var Pathname  = require('./pathname');
var apify     = require('../../utils/apify');


////////////////////////////////////////////////////////////////////////////////


// Returns a RegExp object suitable for file matching.
//
function toFilterRegexp(str) {
  str = String(str);

  if ('/' === str[0] && '/' === str.substr(-1)) {
    return new RegExp(str.substring(1, str.length - 1));
  }

  if (str.match(/^\*\.\w+$/)) {
    //  When "*.js" is given, assume everything but `.js` is an API path.
    //
    //    `*.js` -> `**.js`
    str = '**' + str.substr(1);
  } else if (-1 === str.indexOf('**')) {
    //  When `**` is not explicitly set, assume everything before pattern is
    //  an API path.
    //
    //  `i18n/*.js` -> `**i18n/*.js`
    str = '**' + str;
  }

  str = str.replace(/\./g, '\\.').replace(/\*+/g, function (m) {
    return '*' === m ? '[^/]*?' : '(.*?)';
  });

  return new RegExp('^' + str + '$');
}


// Deduplicates apiPath
//
//    deduplicateApiPath('foo.bar.bar.moo'); // -> 'foo.bar.moo'
//    deduplicateApiPath('foo.bar.moo.moo'); // -> 'foo.bar.moo'
//
function deduplicateApiPath(apiPath) {
  return apiPath.split('.').reduce(function (memo, curr) {
    if (memo[memo.length - 1] !== curr) {
      memo.push(curr);
    }

    return memo;
  }, []).join('.');
}


//  findPaths(lookupConfig) -> Array
//  - lookupConfig (Array | Object): Array of options objects or a single
//  options object.
//
//  Finds matching paths within root, respecting includes/excludes patterns,
//  and returns an array of that paths in alphabetical order.
//
//
//  ##### Options
//
//  - *root* (String)
//  - *pkgName* (String)
//  - *include* (Array, Optional)
//  - *exclude* (Array, Optional)
//
module.exports = function findPaths(lookupConfig) {
  var result = [];

  if (!_.isArray(lookupConfig)) {
    lookupConfig = [ lookupConfig ];
  }

  _.forEach(lookupConfig, function (options) {
    var root     = path.resolve(options.root || '.')
      , pkgName  = options.pkgName
      , included = _([ options.include ]).flatten().compact().map(toFilterRegexp)
      , excluded = _([ options.exclude ]).flatten().compact().map(toFilterRegexp);

    if (!pkgName) {
      throw new Error('findPaths: missed required `pkgName` parameter');
    }

    fstools.walkSync(root, function (filePath) {
      var relativeFilePath = filePath.substr(root.length).replace(/^\/+/, '')
        , matchedPath
        , apiPath;

      function matchPath(regexp) {
        var match = regexp.exec(relativeFilePath);

        if (match) {
          matchedPath = match[1];
        }

        return Boolean(match);
      }

      function mismatchPath(regexp) {
        return !regexp.test(relativeFilePath);
      }

      if (included.any(matchPath) && excluded.every(mismatchPath)) {
        apiPath = apify(matchedPath);

        if (apiPath) {
          apiPath = pkgName + '.' + apiPath;
        } else {
          apiPath = pkgName;
        }

        result.push(new Pathname(filePath, {
          apiPath: deduplicateApiPath(apiPath)
        }));
      }
    });
  });

  return result.sort(function (a, b) {
    return a.pathname.localeCompare(b.pathname);
  });
};
