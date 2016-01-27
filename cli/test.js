// Run tests & exit
//

'use strict';


const path         = require('path');
const _            = require('lodash');
const co           = require('co');
const thenify      = require('thenify');
const Mocha        = require('mocha');
const navit        = require('navit');
const navitPlugins = require('nodeca.core/lib/test/navit_plugins');
const glob         = require('glob');


////////////////////////////////////////////////////////////////////////////////


module.exports.parserParameters = {
  addHelp: true,
  help: 'run test suites',
  description: 'Run all tests of enabled apps'
};


module.exports.commandLineArguments = [
  {
    args: [ 'app' ],
    options: {
      metavar: 'APP_NAME',
      help: 'Run tests of specific application only',
      nargs: '?',
      defaultValue: null
    }
  },

  {
    args:     [ '-m', '--mask' ],
    options: {
      dest:   'mask',
      help:   'Run only tests, containing MASK in name',
      type:   'string',
      defaultValue: []
    }
  }
];


////////////////////////////////////////////////////////////////////////////////

module.exports.run = function (N, args) {

  return co(function* () {
    if (!process.env.NODECA_ENV) {
      throw 'You must provide NODECA_ENV in order to run nodeca test';
    }

    yield Promise.resolve()
      .then(() => N.wire.emit('init:models', N))
      .then(() => N.wire.emit('init:bundle', N))
      .then(() => N.wire.emit('init:server', N));

    let mocha        = new Mocha({ timeout: 10000 });
    let applications = N.apps;

    mocha.reporter('spec');
    // mocha.ui('bdd');

    // if app set, check that it's valid
    if (args.app) {
      if (!_.find(applications, app => app.name === args.app)) {
        /*eslint-disable no-console*/
        let msg = `Invalid application name: ${args.app}` +
            'Valid apps are:  ' + _.map(applications, app => app.name).join(', ');

        throw msg;
      }
    }

    _.forEach(applications, app => {
      if (!args.app || args.app === app.name) {
        glob.sync('**', { cwd: app.root + '/test' })
          // skip files when
          // - filename starts with _, e.g.: /foo/bar/_baz.js
          // - dirname in path starts _, e.g. /foo/_bar/baz.js
          .filter(name => !/^[._]|\\[._]|\/[_.]/.test(name))
          .forEach(file => {
            // try to filter by pattern, if set
            if (args.mask && path.basename(file).indexOf(args.mask) === -1) {
              return;
            }

            if ((/\.js$/).test(file) && path.basename(file)[0] !== '.') {
              mocha.files.push(`${app.root}/test/${file}`);
            }
          });
      }
    });

    // Expose N to globals for tests
    global.TEST = {
      N,
      browser: navit().use(navitPlugins)
    };

    yield thenify(cb => mocha.run(cb))();

    N.shutdown();
  });
};
