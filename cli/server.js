"use strict";


/*global N*/


// 3rd-party
var async = require('async');


module.exports.parserParameters = {
  version:      N.runtime.version,
  addHelp:      true,
  help:         'start nodeca server',
  description:  'Start nodeca server'
};


module.exports.commandLineArguments = [
  {
    args: ['--test'],
    options: {
      help:   'Start server an terminates immediately, ' +
              'with code 0 on init success.',
      action: 'storeTrue'
    }
  }
];


module.exports.run = function (args, callback) {

  async.series([
    function (next) { N.logger.debug('Init app...'); next(); },
    require('../lib/system/init/app'),

    function (next) { N.logger.debug('Init server...'); next(); },
    require('../lib/system/init/server')
  ], function (err) {
    if (err) {
      callback(err);
      return;
    }

    // for `--test` just exit on success
    if (args.test) {
      process.stdout.write('Server exec test OK\n');
      process.exit(0);
    }

    callback();
  });
};
