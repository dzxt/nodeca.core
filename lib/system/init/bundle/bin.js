// `bin` section processor


'use strict';


// 3rd-party
var _ = require('lodash');


////////////////////////////////////////////////////////////////////////////////


module.exports = function (sandbox, callback) {
  // When Mincer is asked for a file, this file must be within roots, that
  // Mincer knows about. See: https://github.com/nodeca/mincer/issues/51
  _.each(sandbox.config.packages, function (pkgConfig) {
    if (pkgConfig.bin) {
      pkgConfig.bin.lookup.forEach(function (options) {
        sandbox.assets.environment.appendPath(options.root);
      });

      pkgConfig.bin.files.forEach(function (p) {
        sandbox.assets.files.push(String(p));
      });
    }
  });

  callback();
};
