"use strict";


/**
 *  server
 **/


/*global nodeca, _*/


// stdlib
var path = require('path');


// 3rd-party
var send = require('send');


////////////////////////////////////////////////////////////////////////////////


var root = path.join(nodeca.runtime.apps[0].root, 'public/root');


////////////////////////////////////////////////////////////////////////////////


/**
 *  server.static(params, callback) -> Void
 *
 *  - **HTTP only**
 *
 *  Middleware that serves static assets from `public/root` directory under the
 *  main application root path.
 **/
module.exports = function (params, callback) {
  var http = this.origin.http;

  if (!http) {
    callback({statusCode: 400, body: "HTTP ONLY"});
    return;
  }

  if ('GET' !== http.req.method && 'HEAD' !== http.req.method) {
    callback({statusCode: 400});
    return;
  }

  send(http.req, params.file)
    .root(root)
    .on('error', function (err) {
      if (404 === err.status) {
        callback({statusCode: 404, body: 'File not found'});
        return;
      }

      callback(err);
    })
    .on('directory', function () {
      callback({statusCode: 400});
    })
    .pipe(http.res);
};
