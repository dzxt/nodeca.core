"use strict";


/*global nodeca */


// FIXME: This will not work in browser - we need cross-side solution
var _ = require('nlib').Vendor.Underscore;


function build(ns, cfg, perms, router) {
  var menu = [];

  _.each(cfg, function (opts, key) {
    var item, p = perms[key] || {allowed: true};

    if (!p.allowed) {
      // permission denied. skip.
      return;
    }

    item = {
      title: 'menus.' + ns + '.' + key,
      priority: opts.priority
    };

    if (opts.to) {
      item.link = router.linkTo(opts.to, opts.params || {});
    }

    if (opts.submenu) {
      item.childs = build(ns + '.' + key, opts.submenu, p.submenu || {}, router);
    }

    menu.push(item);
  });

  return _.sortBy(menu, function (item) {
    var prio = (undefined === item.priority) ? 100 : +item.priority;
    delete item.priority;
    return prio;
  });
}


/**
 *  nodeca.shared.common.build_menus(menu_ids, permissions_map, router) -> Object
 *  - menu_ids (Array):
 *  - permissions_map (Object):
 *  - router (Pointer)
 *
 *  ##### Example
 *
 *      var menu_ids = ['admin', 'common'],
 *          permissions_map = this.response.permissions_map,
 *          router = nodeca.runtime.router;
 *
 *      nodeca.shared.build_menus(menu_ids, permissions_map, router);
 *      // ->
 *      //    {
 *      //      common: {
 *      //        topnav: [
 *      //          {
 *      //            title: menus.common.topnav.profile,
 *      //            link: "http://nodeca.org/user/profile"
 *      //          },
 *      //          // ...
 *      //        ]
 *      //      },
 *      //
 *      //      admin: {
 *      //        "system-sidebar": [
 *      //          {
 *      //            title: menus.admin.system-sidebar.system,
 *      //            childs: [
 *      //              {
 *      //                title: menus.admin.system-sidebar.system.settings,
 *      //                link: "http://nodeca.org/admin/settings",
 *      //                childs: [
 *      //                  {
 *      //                    title: menus.admin.system-sidebar.system.performance,
 *      //                    link: "http://nodeca.org/admin/performance"
 *      //                  },
 *      //                  // ...
 *      //                ]
 *      //              }
 *      //            ]
 *      //          }
 *      //        ]
 *      //      }
 *      //    }
 */
module.exports = function (menu_ids, permissions_map, router) {
  var menus = {};

  nodeca.shared.common.each_menu(menu_ids, function (ns, id, cfg) {
    var perms;

    perms         = (permissions_map[ns] || {})[id];
    menus[ns]     = menus[ns] || {};
    menus[ns][id] = build(ns + '.' + id, cfg, perms || {}, router);
  });

  return menus;
};
