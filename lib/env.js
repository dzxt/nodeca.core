'use strict';


/**
 *  lib
 **/


/*global nodeca, _*/


// 3rd-party
var Puncher = require('puncher');


////////////////////////////////////////////////////////////////////////////////


var tzOffset = (new Date).getTimezoneOffset();


////////////////////////////////////////////////////////////////////////////////


/**
 *  lib.env(options) -> Object
 *  - options (Object): Environment options.
 *
 *  Create new request environment object.
 *
 *
 *  ##### Options
 *
 *  - **http**: HTTP origin object that contains `req` and `res`.
 *  - **rpc**: API3 (Ajax) origin that contains `req` and `res`.
 *  - **skip**: Array of middlewares to skip
 *  - **session**: Session object
 *    - **theme**: Theme name as String
 *    - **locale**: Locale name as String
 *  - **method**: Name of the server method, e.g. `'forums.posts.show'`
 *  - **layout**: Layout name as String
 **/
module.exports = function env(options) {
  var ctx = {
    extras:  {
      puncher: new Puncher()
    },
    helpers: {
      asset_path: function asset_path(path) {
        var asset = nodeca.runtime.assets.manifest.assets[path];
        return !asset ? "#" : nodeca.runtime.router.linkTo('assets', { path: asset });
      }
    },
    origin: {
      http: options.http,
      rpc: options.rpc
    },
    skip: (options.skip || []).slice(),
    // FIXME: should be filled by session middleware
    session: options.session || {
      theme:  'desktop',
      locale: nodeca.config.locales['default']
    },
    request: {
      // FIXME: should be deprecated in flavour of env.origin
      origin:     !!options.rpc ? 'RPC' : 'HTTP',
      method:     options.method,
      namespace:  String(options.method).split('.').shift()
    },
    data: {},
    response: {
      data: {
        head: {
          title: null, // should be filled with default value
          apiPath: options.method,
          // List of assets for yepnope,
          // Each element is an object with properties:
          //
          //    type:   css|js
          //    link:   asset_url
          //
          // example: assets.push({type: 'js', link: '//example.com/foo.js'});
          assets: []
        },
        menus: {},
        widgets: {}
      },
      headers: {},
      // Layouts are supporting "nesting" via `dots:
      //
      //    default.blogs
      //
      // In the example above, `default.blogs` will be rendered first and the
      // result will be provided for rendering to `default`.
      layout: options.layout || 'default',
      // Default view template name == server method name
      // One might override this, to render different view
      //
      view: options.method
    }
  };

  //
  // env-dependent helper needs to be bounded to env
  //

  ctx.helpers.t = function (phrase, params) {
    return nodeca.runtime.i18n.t(this.session.locale, phrase, params);
  }.bind(ctx);


  ctx.helpers.date = function (value, format) {
    return nodeca.shared.common.date(value, format, this.session.locale, tzOffset);
  }.bind(ctx);

  return ctx;
};
