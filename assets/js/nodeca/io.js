/**
 *  nodeca.io
 *
 *  This module provides realtime communication methods for nodeca/nlib based
 *  applications.
 **/


//= depend_on nodeca
//= require faye-browser


/*global window, $, _, Faye, nodeca*/


(function () {
  'use strict';


  var // registered events
      events = {},
      // underlying bayeux client
      bayeux = null,
      // stores last msg id for debug purposes
      // and last xhr to allow interrupt it
      rpc = {idx: 0, xhr: null};


  // exported IO object
  var io = nodeca.io = {};


  //
  // Errors
  //


  io.EWRONGVER  = 'IO_EWRONGVER';


  // error constructor
  function ioerr(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }


  //
  // Events
  //


  // executes all handlers registered for given `event`
  function emit(event, args) {
    _.each(events[event] || [], function (handler) {
      handler.apply(null, args);
    });
  }


  /**
   *  nodeca.io.on(event, handler) -> Void
   *  - event (String)
   *  - handler (Function)
   *
   *  Registers `handler` for an `event`.
   *
   *
   *  ##### Known events
   *
   *  - `connected`
   *  - `disconnected`
   *  - `rpc:version-mismatch({client: "str", server: "str"})`
   **/
  io.on = function on(event, handler) {
    if (!events[event]) {
      events[event] = [];
    }

    events[event].push(handler);
  };


  /**
   *  nodeca.io.off(event[, handler]) -> Void
   *  - event (String)
   *  - handler (Function)
   *
   *  Unsubscribes `handler` (or all handlers) from specified `event`.
   *
   *
   *  ##### See also
   *
   *  - [nodeca.io.on]
   **/
  io.off = function off(event, handler) {
    events[event] = (!handler) ? [] : _.without(events[event], handler);
  };


  //
  // Main API
  //


  function bayeux_call(name, args) {
    var result = bayeux[name].apply(bayeux, args);

    //
    // provide jQuery.Defered style methods
    //

    // FAYE DOCUMENTATION:
    //
    //  Bear in mind that ‘success’ here just means the server received and
    //  routed the message successfully, not that it has been received by all
    //  other clients.
    result.done = _.bind(function (fn) { this.callback(fn); return this; }, result);

    // FAYE DOCUMENTATION:
    //
    //  An error means the server found a problem processing the message.
    //  Network errors are not covered by this.
    result.fail = _.bind(function (fn) { this.errback(fn); return this; }, result);

    return result;
  }


  /**
   *  nodeca.io.subscribe(channel, handler) -> Object
   **/
  io.subscribe = function subscribe(channel, handler) {
    return bayeux_call('subscribe', [channel, handler]);
  };


  /**
   *  nodeca.io.unsubscribe(channel[, handler]) -> Object
   **/
  io.unsubscribe = function unsubscribe(channel, handler) {
    return bayeux_call('unsubscribe', [channel, handler]);
  };


  /**
   *  nodeca.io.publish(channel, message) -> Object
   **/
  io.publish = function publish(channel, message) {
    return bayeux_call('publish', [channel, message]);
  };


  /**
   *  nodeca.io.apiTree(name, params, options, callback) -> Void
   *  nodeca.io.apiTree(name, params[, callback]) -> Void
   *  nodeca.io.apiTree(name, callback) -> Void
   **/
  io.apiTree = function apiTree(name, params, options, callback) {
    var xhr, id = rpc.idx++, data = {id: id};

    // Scenario: rpc(name, callback);
    if (_.isFunction(params)) {
      callback = params;
      params   = options  = {};
    }

    // Scenario: rpc(name, params[, callback]);
    if (_.isFunction(options)) {
      callback = options;
      options = {};
    }

    // fill in defaults
    options   = options || {};
    callback  = callback || $.noop;

    //
    // Interrupt previous rpc request
    //

    if (rpc.xhr) {
      (rpc.xhr.reject || $.noop)();
      rpc.xhr = null;
    }

    // fill in message
    data.msg = {
      version:  nodeca.runtime.version,
      method:   name,
      params:   params
    };

    //
    // Send request
    //

    nodeca.logger.debug('API3 [' + id + '] Sending request', data.msg);
    xhr = rpc.xhr = $.post('/rpc', data);

    //
    // Listen for a response
    //

    xhr.success(function (msg) {
      nodeca.logger.debug('API3 [' + id + '] Received response ' +
                          '(' + String((msg || {}).result).length + ')', msg);

      if (msg.version !== nodeca.runtime.version) {
        // emit version mismatch error
        emit('rpc:version-mismatch', {
          client: nodeca.runtime.version,
          server: msg.version
        });
        callback(ioerr(io.EWRONGVER, 'Client version does not match server.'));
        return;
      }

      try {
        msg.result = JSON.parse(msg.result);
      } catch (err) {
        nodeca.logger.error('Failed parse result', err);
        callback(err);
        return;
      }

      // run actual callback
      callback(msg.err, msg.result);
    });

    //
    // Listen for an error
    //

    xhr.fail(function (err) {
      if (err) {
        // fire callback with error only in case of real error
        // and not due to our "previous request interruption"
        callback(err);
      }
    });
  };


  //
  // Initialization API
  //


  /**
   *  nodeca.io.init() -> Void
   **/
  io.init = function () {
    bayeux = new Faye.Client('/faye');

    if ('development' === nodeca.runtime.env) {
      // export some internals for debugging
      window.fontello_bayeux = bayeux;
    }

    //
    // once connected, client.getState() always returns 'CONNECTED' regardless
    // to the real state, so instead of relying on this state we use our own
    //

    bayeux.bind('transport:up',   function () {
      emit('connected');
    });

    bayeux.bind('transport:down', function () {
      emit('disconnected');
    });
  };
}());
