// Show / apply seeds
//

'use strict';


// stdlib
var path  = require('path');
var fs    = require('fs');


// 3rd-party
var _       = require('lodash');
var async   = require('async');
var fstools = require('fs-tools');
var format  = require('util').format;


////////////////////////////////////////////////////////////////////////////////


var SEEDS_DIR = 'db/seeds';


////////////////////////////////////////////////////////////////////////////////


function seed_run(N, app_name, seed_path, callback) {
  /*eslint-disable no-console*/
  console.log('Applying seed...\n');

  require(seed_path)(N, function (err) {
    var basename = path.basename(seed_path);

    // May be, that's not correct to write console directly,
    // but it's cheap and enougth
    if (err) {
      console.log(format('  %s:%s -- failed\n', app_name, basename));
      callback(err);
      return;
    }

    console.log(format('  %s:%s -- success\n', app_name, basename));
    callback();
  });
}

module.exports.parserParameters = {
  addHelp: true,
  description: 'That will run `.<app_name>/db/seeds/<seed_name>.js` if exists. ' +
    'Or, all seeds from `./db/seeds/seed-name/` folder. If <seed-name>' +
    'missed, then script will show all available seeds for given app. ' +
    'If `-a` missed, then all seed for all apps will be shown.',
  epilog : 'Note: Loading seeds is limited to development/test environment. ' +
    'If you really need to run seed  on production/stageing, use ' +
    'option -f.',
  help: 'show or run existing seeds'
};

module.exports.commandLineArguments = [
  {
    args: [ '-f' ],
    options: {
      help: 'force run without env checking',
      action: 'storeTrue',
      dest: 'force'
    }
  },
  {
    args: [ '-a', '--app' ],
    options: {
      help: 'application name',
      type: 'string'
    }
  },
  {
    args: [ '-n' ],
    options: {
      metavar: 'SEED_NUMBER',
      dest: 'seed_numbers',
      help: 'run seed by number, multiple options allowed',
      type: 'int',
      action: 'append'
    }
  },
  {
    args: [ 'seed' ],
    options: {
      metavar: 'SEED_NAME',
      help: 'seed name',
      nargs: '?',
      defaultValue: null
    }
  }
];

module.exports.run = function (N, args, callback) {
  var app_name = args.app;
  var seed_name = args.seed;
  var env = N.environment;

  function get_app_path(app_name) {
    var app = _.find(N.apps, function (app) {
      return app_name === app.name;
    });
    return app ? app.root : null;
  }

  N.wire.emit([
      'init:models'
    ], N,

    function (err) {
      /*eslint-disable no-console*/

      if (err) {
        callback(err);
        return;
      }

      // If seed name exists - execute seed by name
      //
      if (!!app_name && !!seed_name) {
        // protect production env from accident run
        if ([ 'development', 'test' ].indexOf(env) === -1 && !args.force) {
          callback(format('Error: Can\'t run seed from %s environment. Please, use -f to force.', env));
          return;
        }

        var seed_path = path.join(get_app_path(app_name), SEEDS_DIR, seed_name);

        try {
          fs.readFileSync(seed_path);
        } catch (__) {
          callback(format('Error: Application "%s" - does not have %s', app_name, seed_name));
          return;
        }

        seed_run(N, app_name, seed_path, function (err) {
          if (err) {
            callback(err);
            return;
          }

          N.shutdown();
        });
        return;
      }

      // No seed name - show existing list or execute by number,
      // depending on `-n` argument
      //
      var apps;
      if (app_name) {
        apps = [ { name: app_name, root: get_app_path(app_name) } ];
      } else {
        apps = N.apps;
      }

      // Collect seeds
      //
      var seed_list = [];
      _.forEach(apps, function (app) {

        var seed_dir = path.join(app.root, SEEDS_DIR);
        fstools.walkSync(seed_dir, /\.js$/, function (file) {
          // skip files when
          // - filename starts with _, e.g.: /foo/bar/_baz.js
          // - dirname in path starts _, e.g. /foo/_bar/baz.js
          if (file.match(/(^|\/|\\)_/)) { return; }

          seed_list.push({ name: app.name, seed_path: file });
        });
      });

      // Execute seed by number
      //
      if (!_.isEmpty(args.seed_numbers)) {
        // protect production env from accident run
        if ([ 'development', 'test' ].indexOf(env) === -1 && !args.force) {
          callback(format('Error: Can\'t run seed from %s environment. Please, use -f to force.', env));
          return;
        }

        // check that specified seed exists
        for (var i = 0; i < args.seed_numbers.length; i++) {
          if (!seed_list[args.seed_numbers[i] - 1]) {
            console.log(format('Seed number %d not exists', args.seed_numbers[i]));
            N.shutdown(1);
            return;
          }
        }

        // Execute seeds
        async.eachSeries(args.seed_numbers, function (seed_number, next) {
          seed_run(N, seed_list[seed_number - 1].name, seed_list[seed_number - 1].seed_path, next);
        }, function (err) {
          if (err) { return callback(err); }

          N.shutdown();
        });

        return;
      }

      //
      // No params - just display seeds list
      //
      console.log('Available seeds:\n');

      _.forEach(seed_list, function (seed, idx) {
        console.log(format('  %d. %s: %s', idx + 1, seed.name, path.basename(seed.seed_path)));
      });

      console.log('\nSeeds are shown in `<APP>: <SEED_NAME>` form.');
      console.log('See `seed --help` for details');
      N.shutdown();
    }
  );
};
