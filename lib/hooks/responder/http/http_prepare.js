// Prepare http request for server chain
// - find method (with router)
// - parse parameters


'use strict';


var http  = require('http');
var _     = require('lodash');


module.exports = function (N) {

  //
  // Request logger for http requests
  //
  function log(env) {
    var err = env.err
      , req = env.origin.req
      , message = http.STATUS_CODES[env.status]
      , logger = N.logger.getLogger(env ? ('server.' + env.method) : 'server')
      , level;

    if (err || (N.io.APP_ERROR <= env.status)) {
      message = err ? (err.stack || err.message || err) : message;
      level   = 'fatal';
    } else if (N.io.BAD_REQUEST <= env.status && N.io.APP_ERROR > env.status) {
      level = 'error';
    } else {
      level = 'info';
    }

    logger[level]('%s - "%s %s HTTP/%s" %d "%s" - %s',
                  req.connection.remoteAddress,
                  req.method,
                  req.url,
                  req.httpVersion,
                  env.status,
                  req.headers['user-agent'],
                  message);
  }

  //
  // Init envirement for http
  //

  N.wire.before('responder:http', function http_prepare(env, callback) {
    var req = env.origin.req
      , match = N.runtime.router.match(req.fullUrl)
        // mix GET QUERY params (part after ? in URL) and params from router
        // params from router take precedence
      , params = _.extend({}, req.query, (match || {}).params);


    env.log_request = log;

    env.params = params;

    // Nothing matched -> error
    if (!match) {
      env.err = N.io.NOT_FOUND;
      callback();
      return;
    }

    env.method = match.meta;

    callback();
  });
};
