// Add tabex client to 'N' as `live` and init faye client for instnt messaging.
// Prefix `local.` used to communicate between tabs without server
//
'use strict';


var tabex = require('tabex');
var faye = require('faye/browser/faye-browser');


// Emit event for connectors & add live instance to 'N' (after init `N.runtime`)
//
N.wire.once('navigate.done', { priority: -900 }, function live_init() {

  // Init client for `N.live`
  N.live = tabex.client();


  /////////////////////////////////////////////////////////////////////////////
  // Token update request
  //
  var lastRequest;

  N.live.on('local.common.core.token_live.update_request', function (requestID) {

    // Cancel last update request if runned
    if (lastRequest) {
      lastRequest.cancel();
    }

    // Run RPC request only in one client - lock by unique `requestID`
    N.live.lock('token_live_update_' + requestID, 5000, function () {
      lastRequest = N.io.rpc('common.core.token_live', {}, { persistent: true }).done(function (res) {

        // Send new token back
        N.live.emit('local.common.core.token_live.update_result', res.token_live);
      });
    });
  });


  /////////////////////////////////////////////////////////////////////////////
  // Init faye client
  //

  // Tabex client to communicate with faye
  var flive = tabex.client();
  // Faye client to communicate with server
  var fayeClient = null;
  // Channels subscribed by faye
  var trackedChannels = {};
  // Token to validate connection
  var token = N.runtime.token_live;
  // Flag - waiting token update
  var tokenUpdateStarted = false;
  // Handlers subscribed to token update
  var updateHandlers = [];
  var updateTimeout = null;


  // Request update live token
  //
  // - callback (Function) - call after token update
  //
  function tokenUpdate(callback) {

    // Collect handlers who want update token
    if (callback) {
      updateHandlers.push(callback);
    }

    // If update already started - just wait for finish
    if (tokenUpdateStarted) return;

    // Mark update started
    tokenUpdateStarted = true;

    // Emit update request event to each tab with random ID for lock
    flive.emit('local.common.core.token_live.update_request', Math.round(Math.random() * 1e10));

    // If no response in 5 sec - allow retry
    updateTimeout = setTimeout(function () {
      tokenUpdateStarted = false;
    }, 5000);
  }

  // Handle token update result
  //
  flive.on('local.common.core.token_live.update_result', function (newToken) {
    var handlers = updateHandlers;

    // Update token locally
    token = newToken;
    updateHandlers = [];

    // Mark request stopped
    tokenUpdateStarted = false;
    clearTimeout(updateTimeout);

    // Notify handlers about update
    handlers.forEach(handler => handler());
  });


  // Convert channel names to faye-compatible format: add '/' at start of
  // channel name and replace '.' with '!!'
  //
  function toFayeCompatible(ch) {
    return '/' + ch.replace(/\./g, '!!');
  }


  // Resend events to server (except prefix `local.` and `!sys.`)
  //
  flive.filterIn(function (channel, message, callback) {
    if (fayeClient && channel.indexOf('local.') !== 0 && channel.indexOf('!sys.') !== 0) {

      fayeClient.publish(toFayeCompatible(channel), message.data).then(function () {}, function (err) {

        // If token is invalid - request new and try one more time
        if (err.message.code !== N.io.INVALID_LIVE_TOKEN) return;

        // `tokenUpdate` called here at second time (first in incoming faye filter).
        // It is needed to wait token update and retry after it
        tokenUpdate(function () {
          fayeClient.publish(toFayeCompatible(channel), message.data);
        });
      });

      return;
    }

    callback(channel, message);
  });


  // Connect to messaging server when become master and
  // kill connection if master changed
  //
  flive.on('!sys.master', function (data) {
    // If new master is in our tab - connect
    if (data.node_id === data.master_id) {
      if (!fayeClient) {
        fayeClient = new faye.Client('/io/live');

        fayeClient.addExtension({
          outgoing(message, callback) {
            message.token = token;
            callback(message);
          },
          incoming(message, callback) {
            // If token error - request update
            if (message.error && message.error.code === N.io.INVALID_LIVE_TOKEN) {
              tokenUpdate();
            }

            callback(message);
          }
        });
      }
      return;
    }

    // If new master is in another tab - make sure to destroy zombie connection.
    if (fayeClient) {
      fayeClient.disconnect();
      fayeClient = null;
      trackedChannels = {};
    }
  });


  // Subscribe faye client to chennel and return subscription object
  //
  function fayeSubscribe(channel) {
    return fayeClient.subscribe(toFayeCompatible(channel), function (message) {
      flive.emit(channel, message);
    });
  }


  // If list of active channels changed - subscribe to new channels and
  // remove outdated ones.
  //
  flive.on('!sys.channels.refresh', function (data) {

    if (!fayeClient) return;

    // Filter channels by prefix `local.` and system channels (starts with `!sys.`)
    var channels = data.channels.filter(channel => {
      return channel.indexOf('local.') !== 0 && channel.indexOf('!sys.') !== 0;
    });


    // Unsubscribe removed channels
    //
    Object.keys(trackedChannels).forEach(channel => {
      if (channels.indexOf(channel) === -1) {
        trackedChannels[channel].cancel();
        delete trackedChannels[channel];
      }
    });


    // Subscribe to new channels
    //
    channels.forEach(channel => {
      if (!trackedChannels.hasOwnProperty(channel)) {
        trackedChannels[channel] = fayeSubscribe(channel);

        // If token invalid - update token and try subscribe again
        trackedChannels[channel].errback(err => {
          if (err.message.code !== N.io.INVALID_LIVE_TOKEN) return;

          // `tokenUpdate` called here at second time (first in incoming faye filter).
          // It is needed to wait token update and retry after it
          tokenUpdate(() => { trackedChannels[channel] = fayeSubscribe(channel); });
        });
      }
    });
  });
});
