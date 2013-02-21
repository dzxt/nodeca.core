// Populates `env.response.head.assets` with generic assets needed for the given
// method (based on locale and package name), such as: translations, views, etc.
//

"use strict";


var _ = require('lodash');


module.exports = function (N) {
  
  N.wire.after('server:**:http', { priority: 50 }, function inject_assets_info(env, callback) {

    var key = env.runtime.locale, assetsMap, stylesheetsMap;

    if (!N.runtime.assets.distribution[key]) {
      // should never happen
      callback(new Error("Can't find assets map for " + key));
      return;
    }

    assetsMap      = env.response.data.head.assets      = {};
    stylesheetsMap = env.response.data.head.stylesheets = {};

    _.each(N.runtime.assets.distribution[key], function (assets, pkgName) {
      assetsMap[pkgName] = {
        loadingQueue: assets.loadingQueue,
        css: N.runtime.router.linkTo('core.assets', {
          path: N.runtime.assets.manifest.assets[assets.stylesheet]
        }),
        js: N.runtime.router.linkTo('core.assets', {
          path: N.runtime.assets.manifest.assets[assets.javascript]
        })
      };

      stylesheetsMap[pkgName] = assets.stylesQueue.map(function (stylesheet) {
        return N.runtime.router.linkTo('core.assets', {
          path: N.runtime.assets.manifest.assets[stylesheet]
        });
      });
    });

    callback();
  });
};
