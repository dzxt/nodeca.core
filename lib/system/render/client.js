// client-side renderer. Contains local helpers etc and calls common render
// method internally.


'use strict';


/**
 *  client
 **/


/*global _, N*/


// internal
var render  = require('./common');
var date    = require('../date');


////////////////////////////////////////////////////////////////////////////////


var tzOffset = (new Date).getTimezoneOffset();
var helpers  = {};


////////////////////////////////////////////////////////////////////////////////


helpers.t = N.runtime.t;


helpers.date = function (value, format) {
  return date(value, format, N.runtime.locale, tzOffset);
};


helpers.asset_include = function () {
  N.logger.error('asset_include() is a server-side only helper, ' +
                  'thus can be used in base layouts only.');
  return "";
};


helpers.link_to = function (name, params) {
  return N.runtime.router.linkTo(name, params) || '#';
};


helpers.N = N;


////////////////////////////////////////////////////////////////////////////////


/**
 *  client.render(apiPath[, locals[, layout]]) -> Void
 *  - apiPath (String): Server method API path.
 *  - locals (Object): Locals data for the renderer
 *  - layout (String): Layout or layouts stack
 *
 *  Renders view.
 **/
module.exports = function (apiPath, locals, layout) {
  if (!N.views[apiPath]) {
    throw new Error("View " + apiPath + " not found");
  }

  locals = _.extend(locals || {}, helpers);
  return render(N.views, apiPath, locals, layout, true);
};
