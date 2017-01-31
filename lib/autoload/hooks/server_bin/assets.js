// Asset files handler. Serves Mincer's generated asset files:
// - stylesheets
// - client-side javascripts
// - compiled view templates
// - etc

'use strict';


const path        = require('path');
const send        = require('send');
const Promise     = require('bluebird');
const compression = Promise.promisify(require('compression')());
const eos         = require('end-of-stream');


module.exports = function (N) {
  var root = path.join(N.mainApp.root, 'assets', 'public');


  N.validate('server_bin:core.assets', {
    // DON'T validate unknown params - those can exists,
    // if someone requests '/myfile.txt?xxxx' instead of '/myfile.txt/
    additionalProperties: true,
    properties: {
      path: {
        type: 'string',
        required: true
      }
    }
  });


  N.wire.on('server_bin:core.assets', function asset_file_send(env) {
    return compression(env.origin.req, env.origin.res);
  });

  N.wire.on('server_bin:core.assets', function* asset_file_send(env) {
    var req = env.origin.req,
        res = env.origin.res;

    if (req.method !== 'GET' && req.method !== 'HEAD') throw N.io.BAD_REQUEST;

    yield new Promise((resolve, reject) => {
      send(req, env.params.path, { root, index: false, maxAge: '1y' })
        // Errors with status are not fatal,
        // rethrow those up as code, not as Error
        .on('error', err => reject(err.status || err))
        // On success - wait until res no longer writable
        .on('end', () => eos(res, () => resolve()))
        .pipe(res);
    });
  });
};
