/**
 *  class Wire
 **/


(function (root) {
  "use strict";


  //////////////////////////////////////////////////////////////////////////////


  function noop() {}


  //
  // Helpers for cross-browser compatibility
  //


  var isString = function isString(obj) {
    return Object.prototype.toString.call(obj) === '[object String]';
  };

  var isArray = Array.isArray || function isArray(obj) {
    return Object.prototype.toString.call(obj) === '[object Array]';
  };

  var isFunction = function isFunction(obj) {
    return Object.prototype.toString.call(obj) === '[object Function]';
  };


  //////////////////////////////////////////////////////////////////////////////


  // Structure to hold handler data
  function WireHandler(channel, options, func) {
    this.channel  = channel;
    this.func     = func;
    this.name     = func.name || "<anonymous>";
    this.sync     = 1 === func.length;
    this.once     = Boolean(options.once);
    this.ensure   = Boolean(options.ensure);
    this.priority = Number(options.priority || 0);
    this.ncalled  = 0;
    this.pattern  = new RegExp("^" + channel.replace(/\*+/g, function (m) {
                      // '*' - anything but "dot"
                      // '**' -
                      return '*' === m ? '[^.]+?' : '.+?';
                    }) + "$");
  }


  //////////////////////////////////////////////////////////////////////////////


  function Wire() {
    this.__handlers__       = [];
    this.__sortedCache__    = [];
    this.__knownChannels__  = {};
    this.__skips__          = {};
  }


  Wire.prototype.getHandlers = function (channel) {
    var skip_set = this.__skips__[channel] || {},
        result = [],
        i, handler;

    if (!this.__sortedCache__[channel]) {

      for (i in this.__handlers__) {
        handler = this.__handlers__[i];
        if (handler.pattern.test(channel) && !skip_set[handler.name]) {
          result.push(handler);
        }
      }

      result = result.sort(function (a, b) {
        if (a.priority === b.priority) {
          return 0;
        }
        return (a.priority < b.priority) ? -1 : 1;
      });

      this.__sortedCache__[channel] = result;
    }

    return this.__sortedCache__[channel];
  };


  // Internal helper that runs handlers for a single channel
  function emitSingle(self, channel, params, callback) {
    var stash = self.getHandlers(channel).slice()
      , wh, fn, _err;

    // iterates through handlers of stash
    function walk(err) {

      // chain finished - exit
      if (!stash.length) {
        callback(err);
        return;
      }

      // Get next element
      wh = stash.shift();
      fn = wh.func;

      // if error - skip all handlers except 'ehshured'
      if (err && !wh.ensure) {
        walk(err);
        return;
      }

      wh.ncalled++;

      if (wh.once) {
        self.off(wh.channel, fn);
      }

      // Call handler, but protect err from overrite,
      // if already exists
      if (!wh.sync) {
        fn(params, function (_err) {
          walk(err || _err);
        });
      } else {
        _err = fn(params);
        walk(err || _err);
      }

      return;
    }

    // start stash walker
    walk();
  }


  /**
   *  Wire#emit(channels, params[, callback]) -> Void
   *  - channels (String|Array):
   *  - params (Mixed):
   *  - callback (Function):
   *
   *  Sends message with `params` into the `channel`. Once all sync and ascync
   *  handlers finished, optional `callback(err)` (if specified) fired.
   **/
  Wire.prototype.emit = function (channels, params, callback) {
    var self = this, _chs, chan;

    callback = callback || noop;

    // slightly optimize regular calls, with single channel
    //
    if (!isArray(channels)) {
      emitSingle(self, channels, params, callback);
      return;
    }

    // Lot of channel - do chaining
    //
    _chs = channels.slice();

    function walk(err) {
      if (err || !_chs.length) {
        callback(err);
        return;
      }

      chan = _chs.shift();
      emitSingle(self, chan, params, walk);
    }

    walk();
  };


  /**
   *  Wire#on(channel[, options], handler) -> Void
   *  - channel (String):
   *  - options (Object):
   *  - handler (Function):
   *
   *  Registers `handler` to be executed upon messages in the `channel`. Handler
   *  can be either sync function:
   *
   *      wire.on('foobar', function (params) {
   *        // do stuff here
   *      });
   *
   *  Or it might be an async function with `callback(err)` second argument:
   *
   *      wire.on('foobar', function (params, callback) {
   *        // do stuff here
   *        callback(null);
   *      });
   *
   *
   *  ##### Options
   *
   *  - `priority` (Number, Default: 0)
   *  - `ensure` (Boolean, Default: false)
   *    If `true`, will run handler even if one of previous fired error.
   **/
  Wire.prototype.on = function (channel, options, handler) {
    if (!handler) {
      handler = options;
      options = null;
    }

    options = options || {};

    if (!isFunction(handler)) {
      throw "Not a function";
    }

    if (handler.length < 1 && 2 < handler.length) {
      throw "Function must accept exactly 1 (sync) or 2 (async) arguments";
    }

    if (!channel) {
      throw "Channel is required. Use `**` if you want 'any channel'.";
    }


    var wh = new WireHandler(channel, options, handler);

    // Count main channel handler (no wildcards, zero-priority)
    if ((wh.priority === 0) && (-1 === wh.channel.indexOf('*'))) {
      this.__knownChannels__[channel] = (this.__knownChannels__[channel] || 0) + 1;
    }

    this.__handlers__.push(wh);

    // TODO: Move to separate method
    this.__sortedCache__ = [];
  };


  /**
   *  Wire#once(channel[, options], handler) -> Void
   *  - channel (String):
   *  - options (Object):
   *  - handler (Function):
   *
   *  Same as [[Wire#on]] but runs handler one time only.
   **/
  Wire.prototype.once = function (channel, options, handler) {
    if (!handler) {
      handler = options;
      options = {};
    }

    options = options || {};
    options.once = true;

    this.on(channel, options, handler);
  };


  /**
   *  Wire#before(channel[, options], handler) -> Void
   *  - channel (String):
   *  - options (Object):
   *  - handler (Function):
   *
   *  Same as [[Wire#on]] but with "fixed" priority of `-10`
   **/
  Wire.prototype.before = function (channel, options, handler) {
    if (!handler) {
      handler = options;
      options = {};
    }

    options = options || {};
    options.priority = options.priority || -10;

    if (0 <= options.priority) {
      throw "before() requires priority lower than 0";
    }

    return this.on(channel, options, handler);
  };


  /**
   *  Wire#after(channel[, options], handler) -> Void
   *  - channel (String):
   *  - options (Object):
   *  - handler (Function):
   *
   *  Same as [[Wire#on]] but with default priority of `10`
   **/
  Wire.prototype.after = function (channel, options, handler) {
    if (!handler) {
      handler = options;
      options = {};
    }

    options = options || {};
    options.priority = options.priority || 10;

    if (0 >= options.priority) {
      throw "after() requires priority greater than 0";
    }

    return this.on(channel, options, handler);
  };


  /**
   *  Wire#off(channel[, handler]) -> Void
   *  - channel (String):
   *  - handler (Function):
   *
   *  Removes `handler` of a channel, or removes ALL handlers of a channel if
   *  `handler` is not given.
   **/
  Wire.prototype.off = function (channel, handler) {
    var i, wh;

    for (i in this.__handlers__) {
      wh = this.__handlers__[i];

      if (channel !== wh.channel) {
        continue;
      }

      if (handler && (handler !== wh.func)) {
        continue;
      }

      // Unkount back zero-priority handler
      if ((wh.priority === 0) && (this.__knownChannels__[channel])) {
        this.__knownChannels__[channel]--;
      }
      // Just replace with dummy call, to keep cache lists intact
      wh.sync = true;
      wh.func = noop;
    }
  };


  /**
   *  Wire#skip(channel, skipList) -> Void
   *  - channel (String):
   *  - skipList (Array):
   *
   *  Exclude calling list of named handlers for given chennel:
   *
   *      wire.skip('server:static', [
   *        session_start,
   *        cookies_start
   *      ]);
   *
   **/
  Wire.prototype.skip = function (channel, skipList) {
    var i;

    if (-1 !== channel.indexOf('*')) {
      throw "No wildcards allowed in Wire.skip()";
    }

    if (isString(skipList)) {
      skipList = [skipList];
    }
    if (!isArray(skipList)) {
      throw "skipList must be String or Array of Strings";
    }

    this.__skips__[channel] = this.__skips__[channel] || {};

    for (i in skipList) {
      this.__skips__[channel][skipList[i]] = true;
    }

    // TODO: Move to separate method
    this.__sortedCache__ = [];
  };


  /**
   *  Wire#has(channel) -> Boolean
   *  - channel (String):
   *
   *  Returns if `channel` has at least one subscriber
   *  with zero priority (main handler)
   **/
  Wire.prototype.has = function (channel) {
    return Boolean(this.__knownChannels__[channel]);
  };


  /**
   *  Wire#stat() -> Object
   *
   *  Returns full statictics about all channels. Only channels without wildcards
   *  are displayed. Each channel has following structures:
   *
   *  ```
   *  {
   *    name: channnelName,
   *    listeners: Array[handlerStat]
   *  }
   *  ```
   **/
  Wire.prototype.stat = function () {
    var _channel, result = [];

    for(_channel in this.__knownChannels__) {
      result.push({ name : _channel, listeners: this.getHandlers(_channel) });
    }

    return result;
  };


  //////////////////////////////////////////////////////////////////////////////


  // Node.JS
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Wire;
  // Browser
  } else {
    root.Wire = Wire;
  }
}(this));
