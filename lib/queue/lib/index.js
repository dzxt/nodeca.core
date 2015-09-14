// Queue class
//
// Redis keys structure (all keys starts with prefix defined in constructor, "queue:" by default):
//
// - postponed               (zset) - postponed tasks IDs
// - pending                 (set)  - incoming tasks IDs
// - mapping                 (zset) - tasks with state `mapping`
// - aggregating             (set)  - tasks with state `aggregating`
// - reducing                (zset) - tasks with state `reducing`
// - <taskID>                (hash) - task options (type, retries, state, data)
// - <taskID>:postponed      (hash) - task options for postponed tasks
// - <taskID>:chunks:pending (set)  - pending chunks IDs
// - <taskID>:chunks:active  (zset) - active chunks IDs
// - <taskID>:chunks:errored (zset) - errored chunks IDs
// - <taskID>:chunks:done    (set)  - finished chunks IDs
// - <taskID>:<chunkID>      (hash) - chunk's data (retries, data, result)
//
'use strict';


var CronJob      = require('cron').CronJob;
var inherits     = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var _            = require('lodash');
var path         = require('path');
var fs           = require('fs');


var Worker       = require('./worker');
var Task         = require('./task');
var Chunk        = require('./chunk');


///////////////////////////////////////////////////////////////////////////////
// Error returned from worker code (from `map`, `reduce` or `process` methods)
//
// - wrappedError (String | Object) - caused error
// - workerName (String) - the worker name
// - taskState (String) - current task state
// - taskID (String) - the task id
// - chunkID (String) - the chunk id, null for `mapping` and `reducing`
// - dataToProcess (Object) - data passed to `map`, `reduce` or `process` method
//
function QueueError(wrappedError, workerName, taskState, taskID, chunkID, dataToProcess) {
  this.name = 'QueueError';
  this.message = wrappedError.toString() +
                 ' (worker: ' + workerName + ', state: ' + taskState + ', task ID: ' + taskID + ')';

  this.wrappedError = wrappedError;
  this.workerName = workerName;
  this.taskState = taskState;
  this.taskID = taskID;
  this.chunkID = chunkID;
  this.dataToProcess = dataToProcess;
}

inherits(QueueError, Error);


// Redis time to milliseconds
//
// - time (Array) - time from redis
//
function redisToMs(time) {
  // Redis reply containing two elements: unix time in seconds, microseconds
  return time[0] * 1000 + Math.round(time[1] / 1000);
}


///////////////////////////////////////////////////////////////////////////////
// Queue constructor
//
// - redis (RedisClient) - redis client instance
// - prefix (String) - optional. Redis keys prefix, "queue:" by default
//
function Queue(redis, prefix) {
  this.__redis__ = redis;
  this.__timer__ = null;
  this.__stopped__ = false;
  this.__workers__ = {};
  this.__prefix__ = prefix || 'queue:';

  var scripts = {};

  // Read lua scripts
  fs.readdirSync(path.join(__dirname, '../scripts')).forEach(function (fileName) {
    scripts[path.basename(fileName, '.lua')] = fs.readFileSync(path.join(__dirname, '../scripts', fileName), 'utf-8');
  });

  this.__scripts__ = scripts;

  this.__init__();
}


// Global events:
//
// - error
//
inherits(Queue, EventEmitter);


// Register new worker
//
// registerWorker(name [, cron], process):
//
// - name (String) - the worker's name
// - cron (String) - optional, cron string ("15 */6 * * *"), default null
// - process (Function) - called as: `chunk.process(callback)`
//   - this (Object) - current chunk (chunk data is available as `this.data`)
//   - callback (Function) - called as: `function (err, result)`
//
// registerWorker(options):
//
// - options (Object)
//   - name (String) - the worker's name
//   - taskID (Function) - optional, should return new task id. Needed only for
//     creating exclusive tasks, return random value by default, called as: `function (taskData)`
//   - chunksPerInstance (Number) - optional, available count of parallel chunks in one
//     process (Infinity - not restricted), default Infinity
//   - retry (Number) - optional, number of retry on error, default 2
//   - retryDelay (Number) - optional, delay in ms after retries, default 60000 ms
//   - timeout (Number) - optional, `map`, `chunk` and `reduce` execution timeout, default 30000 ms
//   - postponeDelay (Number) - optional, if postpone is called without delay, delay is assumed to be equal to this
//   - cron (String) - optional, cron string ("15 */6 * * *"), default null
//   - map (Function) - optional, proxy taskData to single chunk by default,
//     called as: `task.map(callback)`
//     - this (Object) - current task (task data is available as `this.data`)
//     - callback (Function) - called as: `function (err, chunksData)`
//       - chunksData (Array) - array of chunks data
//   - process (Function) - called as: `chunk.process(callback)`
//     - this (Object) - current chunk (chunk data is available as `this.data`)
//     - callback (Function) - called as: `function (err, result)`
//   - reduce (Function) - optional, only call `callback` by default,
//     called as: `task.reduce(chunksResult, callback)`
//     - this (Object) - current task
//     - chunksResult (Array) - array of chunks results
//     - callback (Function) - called as: `function (err)`
//
// `map`, `chunk` and `reduce` should never return errors in normal case, only in critical exceptions
//
Queue.prototype.registerWorker = function () {
  var options;

  // if `registerWorker(options)`
  if (arguments.length === 1) {
    options = _.clone(arguments[0]);

  // if `registerWorker(name, worker)`
  } else if (arguments.length === 2) {
    options = {
      name: arguments[0],
      process: arguments[1]
    };

  // if `registerWorker(name, cron, worker)`
  } else {
    options = {
      name: arguments[0],
      cron: arguments[1],
      process: arguments[2]
    };
  }

  if (this.__workers__[options.name]) {
    throw new Error('Queue registerWorker error: worker with name "' + options.name + '" already registered.');
  }

  var worker = new Worker(options);

  this.__workers__[options.name] = worker;

  if (worker.cron) {
    this.__schedule__(worker);
  }
};


// Run the task immediately
//
// - workerName (String) - the worker name
// - taskData (Object) - optional, the task params
// - callback (Function) - called as: `function (err)`
//
Queue.prototype.push = function (workerName, taskData, callback) {
  if (!callback) {
    callback = taskData;
    taskData = null;
  }

  this.__addTask__(workerName, taskData, callback);
};


// Postpone the task executions
//
// - workerName (String) - the worker name
// - taskData (Object) - optional, the task params, default: `null`
// - delay (Number) - optional, delay execution for the given amount of time, default: `worker.postponeDelay`
// - callback (Function) - called as: `function (err)`
//
Queue.prototype.postpone = function (workerName, taskData, delay, callback) {
  var self = this;
  var worker = this.__workers__[workerName];

  // Skip if worker not registered on this instance
  if (!worker) {
    callback(new Error('Queue add task error: worker with name "' + workerName + '" not exists.'));
    return;
  }

  if (arguments.length === 2) {
    // postpone(workerName, callback)
    callback = taskData;
    delay = taskData = null;
  } else if (arguments.length === 3) {
    // postpone(workerName, delay, callback) if 2nd argument is a number
    // postpone(workerName, taskData, callback) otherwise
    callback = delay;

    if (Number.isFinite(taskData)) {
      delay = taskData;
      taskData = null;
    } else {
      delay = null;
    }
  }

  if (!Number.isFinite(delay)) {
    delay = worker.postponeDelay;
  }

  // Add global prefix and worker name to every task ID
  var taskID = self.__prefix__ + worker.name + ':' + worker.taskID(taskData);

  self.__redis__.time(function (err, redisTime) {
    if (err) {
      self.emit('error', err);
      return;
    }

    var time = redisToMs(redisTime) + delay;

    // Create a new task in the postponed set
    //
    // - prefix
    // - task ID
    // - worker name
    // - task data
    // - delay
    //
    self.__redis__.eval(
      self.__scripts__.task_add_postponed,
      2,
      self.__prefix__,
      taskID,
      workerName,
      JSON.stringify(taskData),
      time,
      callback
    );
  });
};


// Stop accepting new tasks from queue. Active tasks continue execution
//
Queue.prototype.shutdown = function () {
  this.__stopped__ = true;
};


///////////////////////////////////////////////////////////////////////////////
// Private methods


// Schedule the task executions
//
// - worker (Object) - worker options
//
Queue.prototype.__schedule__ = function (worker) {
  var self = this;

  var job = new CronJob(worker.cron, function scheduledRun() {
    if (self.__stopped__) {
      return;
    }

    // To generate `sheduledID` we use timestamp of next exec because `node-cron`
    // doesn't present timestamp of current exec
    var scheduledID = [ self.__prefix__, 'cron:', worker.name, ':', this.cronTime.sendAt().format('X') ].join('');

    // Check if another instance scheduled the task
    self.__redis__.setnx(scheduledID, scheduledID, function (err, acquired) {
      if (err) {
        self.emit('error', err);
        return;
      }

      // Exit if the task already scheduled in different instance
      if (!acquired) {
        return;
      }

      // Set tracker lifetime (3 days) to auto collect garbage
      self.__redis__.expire(scheduledID, 72 * 60 * 60 * 1000, function (err) {
        if (err) {
          self.emit('error', err);
          return;
        }

        self.__addTask__(worker.name, null, function (err) {
          if (err) {
            self.emit('error', err);
          }
        });
      });
    });
  });

  job.start();
};


// Add new task to pending set
//
// - workerName (String) - the worker name
// - taskData (Object) - serializable task data, will be passed to `map`
// - callback (Function)
//
Queue.prototype.__addTask__ = function (workerName, taskData, callback) {
  var self = this;
  var worker = this.__workers__[workerName];

  // Skip if worker not registered on this instance
  if (!worker) {
    callback(new Error('Queue add task error: worker with name "' + workerName + '" not exists.'));
    return;
  }

  // Add global prefix and worker name to every task ID
  var taskID = self.__prefix__ + worker.name + ':' + worker.taskID(taskData);

  // Check that the task not exists yet and add
  //
  // - prefix
  // - task ID
  // - worker name
  // - task data
  //
  self.__redis__.eval(
    self.__scripts__.task_add,
    2,
    self.__prefix__,
    taskID,
    workerName,
    JSON.stringify(taskData),
    callback
  );
};


// Map task
//
// - task (String) - the task to perform map operation on
// - timestamp (Number) - used to avoid races on retrying task by watchdog
//
Queue.prototype.__doMap__ = function (task, timestamp) {
  var self = this;
  var worker = task.worker;

  // Execute worker's map to get chunks
  task.map(function (err, chunksData) {

    // On error we should postpone next map execution
    if (err) {
      // Send error event with error, worker name and task ID to have ability group errors
      self.emit('error', new QueueError(err, worker.name, 'mapping', task.id, null, task.data));

      // Get redis current time to set retry timeout
      self.__redis__.time(function (err, time) {
        // If error caused by redis restart/crash, the task will be retried after 'timeout' anyway
        if (err) {
          self.emit('error', err);
          return;
        }

        // Postpone next retry with delay. Params:
        //
        // - prefix
        // - task ID
        // - timestamp of next retry
        // - old timestamp to be sure what watchdog did not updated this task in retry attempt
        //
        self.__redis__.eval(
          self.__scripts__.task_mapping_to_mapping,
          2,
          self.__prefix__,
          task.id,
          redisToMs(time) + worker.retryDelay,
          timestamp,
          function (err) {
            if (err) {
              self.emit('error', err);
              return;
            }
          }
        );
      });
      return;
    }

    // Process arguments for `task_mapping_to_aggregating` script

    // Set prefix
    var args = [ self.__prefix__ ];

    // Set chunks IDs
    args = args.concat(chunksData.map(function (__, i) {
      return task.id + ':' + i;
    }));

    // Set `taskID`
    args.push(task.id);

    // Set chunks data
    args = args.concat(chunksData.map(function (chunkData) {
      return JSON.stringify(chunkData);
    }));

    // Set script and arguments length
    args = [
      self.__scripts__.task_mapping_to_aggregating,
      args.length / 2
    ].concat(args);

    // Move task from mapping to aggregating and add chunks
    self.__redis__.eval(args, function (err, moved) {
      if (err) {
        self.emit('error', err);
        return;
      }

      if (!moved) {
        return;
      }

      // On success try do next step immediately to minimize latency
      self.__doAggregate__(task.id);
    });
  });
};


// Update task's deadline in mapping set and run again suspended or errored `map`
//
// - taskID (String) - the task ID
// - timestamp (Number) - old task's deadline. Used to avoid races on retrying task by watchdog
//
Queue.prototype.__retryMapping__ = function (taskID, timestamp) {
  var self = this;

  // Get redis time and task options
  self.__redis__.multi()
      .time()
      .hmget(taskID, 'data', 'type', 'retries')
      .exec(function (err, data) {

    if (err) {
      self.emit('error', err);
      return;
    }

    var time = data[0];
    var taskData = data[1][0];
    var workerName = data[1][1];
    var taskRetries = data[1][2];

    var worker = self.__workers__[workerName];

    // Check if retry count exceeded
    if (taskRetries > worker.retry) {
      self.__deleteTask__(taskID);
      return;
    }

    var deadline = redisToMs(time) + worker.timeout;

    // Update task timeout deadline. Params:
    //
    // - prefix
    // - task ID
    // - timestamp of max task age
    // - old timestamp to be sure what watchdog did not updated this task in retry attempt
    //
    self.__redis__.eval(
      self.__scripts__.task_mapping_to_mapping,
      2,
      self.__prefix__,
      taskID,
      deadline,
      timestamp,
      function (err, updated) {
        if (err) {
          self.emit('error', err);
          return;
        }

        // If another process got task - skip
        if (!updated) {
          return;
        }

        var task = new Task(taskID, JSON.parse(taskData), worker, self);

        // Execute map
        self.__doMap__(task, deadline);
      }
    );
  });
};


// Move task from pending to mapping and run `map`
//
// - taskID (String) - the task ID
//
Queue.prototype.__consumeTask__ = function (taskID) {
  var self = this;

  // Get redis time and task options
  self.__redis__.multi()
      .time()
      .hmget(taskID, 'data', 'type')
      .exec(function (err, data) {

    if (err) {
      self.emit('error', err);
      return;
    }

    var time = data[0];
    var taskData = data[1][0];
    var workerName = data[1][1];

    var worker = self.__workers__[workerName];

    var deadline = redisToMs(time) + worker.timeout;

    // Try move task from pending set to mapping set. Params
    //
    // - prefix
    // - task ID
    // - timestamp of max task age
    //
    self.__redis__.eval(
      self.__scripts__.task_pending_to_mapping,
      2,
      self.__prefix__,
      taskID,
      deadline,
      null,
      function (err, moved) {
        if (err) {
          self.emit('error', err);
          return;
        }

        // If another process got task - skip
        if (!moved) {
          return;
        }

        var task = new Task(taskID, JSON.parse(taskData), worker, self);

        // Execute map
        self.__doMap__(task, deadline);
      }
    );
  });
};


// Process single chunk
//
// - worker (Object) - the worker options
// - taskID (String) - the task ID
// - chunkID (String) - the chunk ID
// - data (Object) - chunk data
// - timestamp (Number) - used to avoid races on retrying task by watchdog
//
Queue.prototype.__doProcess__ = function (chunk, timestamp) {
  var self = this;
  var task = chunk.task;
  var worker = task.worker;

  worker.chunksTracker[task.id]++;

  // Execute worker's chunk to get result
  chunk.process(function (err, result) {
    // On error we should postpone next chunk execution
    if (err) {
      // Send error event with error, worker name, task ID and chunk ID to have ability group errors
      self.emit('error', new QueueError(err, worker.name, 'aggregating', task.id, chunk.id, chunk.data));

      // Get redis current time to set retry timeout
      self.__redis__.time(function (err, time) {
        // If error caused by redis restart/crash, the task will be retried after 'timeout' anyway
        if (err) {
          worker.chunksTracker[task.id]--;
          self.emit('error', err);
          return;
        }

        // Postpone next retry with delay. Params:
        //
        // - task ID
        // - chunk ID
        // - timestamp of next retry
        // - old timestamp to be sure what watchdog did not updated this task in retry attempt
        //
        self.__redis__.eval(
          self.__scripts__.chunk_active_to_errored,
          2,
          task.id,
          chunk.id,
          redisToMs(time) + worker.retryDelay,
          timestamp,
          function (err) {
            // Decrement ran chunks count on this instance to allow get one more
            worker.chunksTracker[task.id]--;

            if (err) {
              self.emit('error', err);
            }
          }
        );
      });
      return;
    }

    // Move chunk to finished. Params:
    //
    // - task ID
    // - chunk ID
    // - chunk result or null
    //
    self.__redis__.eval(
      self.__scripts__.chunk_active_to_done,
      2,
      task.id,
      chunk.id,
      JSON.stringify(result || null),
      null,
      function (err, moved) {
        if (err) {
          worker.chunksTracker[task.id]--;
          self.emit('error', err);
          return;
        }

        // Decrement ran chunks count on this instance to allow get one more
        worker.chunksTracker[task.id]--;

        if (moved) {
          // On success try do next step immediately to minimize latency
          self.__doAggregate__(task.id);
        }
      }
    );
  });
};


// Move chunk from pending to active and execute it
//
// - worker (Object) - the worker options
// - taskID (String) - the task ID
// - chunkID (String) - the chunk ID
//
Queue.prototype.__consumeChunk__ = function (worker, taskID, chunkID) {
  var self = this;

  // Get redis time and task options
  self.__redis__.multi()
      .time()
      .hmget(chunkID, 'data', 'retries')
      .exec(function (err, data) {

    if (err) {
      self.emit('error', err);
      return;
    }

    var time = data[0];
    var chunkData = data[1][0];
    var chunkRetries = data[1][1];

    // Check if retry count exceeded
    if (chunkRetries > worker.retry) {
      self.__deleteChunk__(taskID, chunkID);
      return;
    }

    var deadline = redisToMs(time) + worker.timeout;

    // Try move chunk from pending set to active set. Params:
    //
    // - task ID
    // - chunk UD
    // - timestamp of max chunk's age
    //
    self.__redis__.eval(
      self.__scripts__.chunk_pending_to_active,
      2,
      taskID,
      chunkID,
      deadline,
      null,
      function (err, moved) {
        if (err) {
          self.emit('error', err);
          return;
        }

        // If another process got chunk - skip
        if (!moved) {
          return;
        }

        var task = new Task(taskID, null, worker, self);
        var chunk = new Chunk(chunkID, JSON.parse(chunkData), task);

        self.__doProcess__(chunk, deadline);
      }
    );
  });
};


// Reduce task
//
// - task (Object) - task to perform reduce on
// - timestamp (Number) - used to avoid races on retrying task by watchdog
//
Queue.prototype.__doReduce__ = function (task, timestamp) {
  var self = this;
  var worker = task.worker;

  self.__redis__.smembers(task.id + ':chunks:done', function (err, chunksIDs) {
    if (err) {
      self.emit('error', err);
      return;
    }

    var query = self.__redis__.multi();

    chunksIDs.forEach(function (chunkID) {
      query.hget(chunkID, 'result');
    });

    query.exec(function (err, chunksResultsStrings) {
      if (err) {
        self.emit('error', err);
        return;
      }

      var chunksResults = [];

      chunksResultsStrings.forEach(function (chunkDataStr) {
        chunksResults.push(JSON.parse(chunkDataStr));
      });

      task.reduce(chunksResults, function (err) {

        // On error we should postpone next reduce execution
        if (err) {
          // Send error event with error, worker name and task ID to have ability group errors
          self.emit('error', new QueueError(err, worker.name, 'reducing', task.id, null, chunksResults));

          // Get redis current time to set retry timeout
          self.__redis__.time(function (err, time) {
            // If error caused by redis restart/crash, the task will be retried after 'timeout' anyway
            if (err) {
              self.emit('error', err);
              return;
            }

            // Postpone next retry with delay. Params:
            //
            // - prefix
            // - task ID
            // - timestamp of next retry
            // - old timestamp to be sure what watchdog did not updated this task in retry attempt
            //
            self.__redis__.eval(
              self.__scripts__.task_reducing_to_reducing,
              2,
              self.__prefix__,
              task.id,
              redisToMs(time) + worker.retryDelay,
              timestamp,
              function (err) {
                if (err) {
                  self.emit('error', err);
                  return;
                }
              }
            );
          });
          return;
        }

        // Delete task when it is finished
        self.__deleteTask__(task.id);
      });
    });
  });
};


// Update task's deadline in reducing set and run again suspended or errored `reduce`
//
// - taskID (String) - the task ID
// - timestamp (Number) - old task's deadline. Used to avoid races on retrying task by watchdog
//
Queue.prototype.__retryReducing__ = function (taskID, timestamp) {
  var self = this;

  // Get redis time and task options
  self.__redis__.multi()
      .hmget(taskID, 'type', 'retries')
      .time()
      .exec(function (err, data) {

    if (err) {
      self.emit('error', err);
      return;
    }

    var workerName = data[0][0];
    var taskRetries = data[0][1];
    var time = data[1];

    var worker = self.__workers__[workerName];

    // Check if retry count exceeded
    if (taskRetries > worker.retry) {
      self.__deleteTask__(taskID);
      return;
    }

    var deadline = redisToMs(time) + worker.timeout;

    // Update task deadline. Params:
    //
    // - prefix
    // - task ID
    // - timestamp of max task age
    // - old timestamp to be sure what watchdog did not updated this task in retry attempt
    //
    self.__redis__.eval(
      self.__scripts__.task_reducing_to_reducing,
      2,
      self.__prefix__,
      taskID,
      deadline,
      timestamp,
      function (err, updatetd) {
        if (err) {
          self.emit('error', err);
          return;
        }

        // If another process got task - skip
        if (!updatetd) {
          return;
        }

        var task = new Task(taskID, null, worker, self);

        self.__doReduce__(task, deadline);
      }
    );
  });
};


// Delete chunk ID from `<taskID>:chunks:*` sets and delete `<chunkID>` hash
//
// - taskID (String) - the task ID
// - chunkID (String) - the chunk ID
//
Queue.prototype.__deleteChunk__ = function (taskID, chunkID) {
  var self = this;

  self.__redis__.multi()
      .srem(taskID + ':chunks:pending', chunkID)
      .zrem(taskID + ':chunks:active', chunkID)
      .zrem(taskID + ':chunks:errored', chunkID)
      .srem(taskID + ':chunks:done', chunkID)
      .del(chunkID)
      .exec(function (err) {

    if (err) {
      self.emit('error', err);
      return;
    }
  });
};


// Delete task from all sets and delete all keys associated with task
//
// - taskID (String) - the task ID
//
Queue.prototype.__deleteTask__ = function (taskID) {
  var self = this;

  // Get all chunks IDs
  self.__redis__.multi()
      .smembers(taskID + ':chunks:pending')
      .zrange(taskID + ':chunks:active', 0, -1)
      .zrange(taskID + ':chunks:errored', 0, -1)
      .smembers(taskID + ':chunks:done')
      .exec(function (err, result) {

    if (err) {
      self.emit('error', err);
      return;
    }

    // Process all keys associated with task
    var keys = [
      taskID,
      taskID + ':chunks:pending',
      taskID + ':chunks:active',
      taskID + ':chunks:errored',
      taskID + ':chunks:done'
    ]
      // Chunks IDs from `<taskID>:chunks:pending`
      .concat(result[0])
      // Chunks IDs from `<taskID>:chunks:active`
      .concat(result[1])
      // Chunks IDs from `<taskID>:chunks:errored`
      .concat(result[2])
      // Chunks IDs from `<taskID>:chunks:done`
      .concat(result[3]);

    self.__redis__.multi()
        // Remove task from all queue sets
        .srem(self.__prefix__ + 'pending', taskID)
        .zrem(self.__prefix__ + 'mapping', taskID)
        .srem(self.__prefix__ + 'aggregating', taskID)
        .zrem(self.__prefix__ + 'reducing', taskID)
        // Remove task keys
        .del(keys)
        .exec(function (err) {

      if (err) {
        self.emit('error', err);
        return;
      }
    });
  });
};


// Process chunks or move the task to reducing if chunks done
//
// - taskID (String) - the task ID
//
Queue.prototype.__doAggregate__ = function (taskID) {
  var self = this;

  // Get task type, chunks count in pending, active and errored sets and time
  self.__redis__.multi()
      .hget(taskID, 'type')
      .scard(taskID + ':chunks:pending')
      .zcard(taskID + ':chunks:active')
      .zcard(taskID + ':chunks:errored')
      .time()
      .exec(function (err, data) {

    if (err) {
      self.emit('error', err);
      return;
    }

    var workerName = data[0];
    var pendingChunksCount = data[1];
    var activeChunksCount = data[2];
    var erroredChunksCount = data[3];
    var time = data[4];

    var worker = self.__workers__[workerName];

    // If all chunks done - change state to reducing
    if (pendingChunksCount === 0 && activeChunksCount === 0 && erroredChunksCount === 0) {
      var deadline = redisToMs(time) + worker.timeout;

      // Move the task from aggregating to reducing and update their state
      //
      // - prefix
      // - task ID
      // - timestamp of max task age
      //
      self.__redis__.eval(
        self.__scripts__.task_aggregating_to_reducing,
        2,
        self.__prefix__,
        taskID,
        deadline,
        null,
        function (err, moved) {
          if (err) {
            self.emit('error', err);
            return;
          }

          // If another process got task - skip
          if (!moved) {
            return;
          }

          var task = new Task(taskID, null, worker, self);

          self.__doReduce__(task, deadline);
        }
      );
      return;
    }

    // Move errored and suspended chunks back to pending before grab new chunks
    //
    // - task ID
    // - timestamp of max chunks age
    //
    self.__redis__.eval(
      self.__scripts__.chunk_active_and_errored_to_pending,
      1,
      taskID,
      redisToMs(time),
      function (err) {
        if (err) {
          self.emit('error', err);
          return;
        }

        // Set initial value for `chunksTracker`
        worker.chunksTracker[taskID] = worker.chunksTracker[taskID] || 0;

        // If max chunks count exceeded - skip
        if (worker.chunksTracker[taskID] >= worker.chunksPerInstance) {
          return;
        }

        // Get chunks from pending queue
        //
        var command;
        var args;

        // If we can process finite count of chunks - get random chunks from pending queue
        if (isFinite(worker.chunksPerInstance)) {
          command = 'srandmember';
          args = [
            taskID + ':chunks:pending',
            worker.chunksPerInstance - worker.chunksTracker[taskID]
          ];

          // If chunks count not limited - process all chunks
        } else {
          command = 'smembers';
          args = [
            taskID + ':chunks:pending'
          ];
        }

        self.__redis__[command](args, function (err, chunkIDs) {
          if (err) {
            self.emit('error', err);
            return;
          }

          chunkIDs.forEach(function (chunkID) {
            self.__consumeChunk__(worker, taskID, chunkID);
          });
        });
      }
    );
  });
};


// Check is worker registered on this instance without fetch additional data from redis
//
// - taskID (String) - the task ID
//
Queue.prototype.__hasKnownWorker__ = function (taskID) {
  var workersNames = Object.keys(this.__workers__);

  for (var i = 0; i < workersNames.length; i++) {
    if (taskID.indexOf(this.__prefix__ + workersNames[i] + ':') === 0) {
      return true;
    }
  }

  return false;
};


// Change currently running task deadline
//
// - taskID (String) - task ID
// - timeLeft (Number) - amount of time until new deadline
// - callback (Function)
//
Queue.prototype.__setTaskDeadline__ = function (taskID, timeLeft, callback) {
  var self = this;

  // make callback optional, emit errors by default
  callback = callback || function (err) {
    if (err) {
      self.emit('error', err);
      return;
    }
  };

  self.__redis__.time(function (err, redisTime) {
    if (err) {
      self.emit('error', err);
      return;
    }

    var deadline = redisToMs(redisTime) + timeLeft;

    self.__redis__.multi()
        .eval(self.__scripts__.zadd_xx, 1, self.__prefix__ + 'mapping', deadline, taskID)
        .eval(self.__scripts__.zadd_xx, 1, self.__prefix__ + 'reducing', deadline, taskID)
        .exec(callback);
  });
};


// Change currently running task's chunk deadline
//
// - chunkID (String) - chunk ID
// - timeLeft (Number) - amount of time until new deadline
// - callback (Function)
//
Queue.prototype.__setChunkDeadline__ = function (chunkID, taskID, timeLeft, callback) {
  var self = this;

  // make callback optional, emit errors by default
  callback = callback || function (err) {
    if (err) {
      self.emit('error', err);
      return;
    }
  };

  self.__redis__.time(function (err, redisTime) {
    if (err) {
      self.emit('error', err);
      return;
    }

    var deadline = redisToMs(redisTime) + timeLeft;

    self.__redis__.eval(self.__scripts__.zadd_xx, 1, taskID + ':chunks:active', deadline, chunkID, callback);
  });
};


// Get and process tasks
//
Queue.prototype.__tick__ = function () {
  var self = this;

  if (self.__stopped__) {
    return;
  }

  self.__redis__.time(function (err, redisTime) {
    if (err) {
      self.emit('error', err);
      return;
    }

    var time = redisToMs(redisTime);
    var setName;

    // Here could be `async.parallel` but we don't need callbacks

    // Monitor postponed tasks
    //
    setName = self.__prefix__ + 'postponed';

    self.__redis__.zrangebyscore(setName, '-inf', time, function (err, taskIDs) {
      if (err) {
        self.emit('error', err);
        return;
      }

      taskIDs.forEach(function (taskID) {
        if (self.__hasKnownWorker__(taskID)) {
          // Try to move task from postponed set to pending set. If a task with
          // the same ID is already running, do nothing.
          //
          // - prefix
          // - task ID
          //
          self.__redis__.eval(
            self.__scripts__.task_postponed_to_pending,
            2,
            self.__prefix__,
            taskID,
            function (err) {
              if (err) {
                self.emit('error', err);
                return;
              }
            }
          );
        }
      });
    });


    // Monitor new pending tasks
    //
    self.__redis__.smembers(self.__prefix__ + 'pending', function (err, taskIDs) {
      if (err) {
        self.emit('error', err);
        return;
      }

      taskIDs.forEach(function (taskID) {
        if (self.__hasKnownWorker__(taskID)) {
          self.__consumeTask__(taskID);
        }
      });
    });


    // Monitor new task's chunks
    //
    self.__redis__.smembers(self.__prefix__ + 'aggregating', function (err, taskIDs) {
      if (err) {
        self.emit('error', err);
        return;
      }

      taskIDs.forEach(function (taskID) {
        if (self.__hasKnownWorker__(taskID)) {
          self.__doAggregate__(taskID);
        }
      });
    });


    // Watchdog suspended and error tasks at mapping state
    //
    setName = self.__prefix__ + 'mapping';

    // Get tasks IDs and its deadlines
    self.__redis__.zrangebyscore(setName, '-inf', time, 'withscores', function (err, result) {
      if (err) {
        self.emit('error', err);
        return;
      }

      for (var i = 0; i < result.length; i += 2) {
        // `result[i]` contains taskID, `result[i + 1]` contains its score
        if (self.__hasKnownWorker__(result[i])) {
          self.__retryMapping__(result[i], result[i + 1]);
        }
      }
    });


    // Watchdog suspended and error tasks at reducing state
    //
    setName = self.__prefix__ + 'reducing';

    // Get tasks IDs and its deadlines
    self.__redis__.zrangebyscore(setName, '-inf', time, 'withscores', function (err, result) {
      if (err) {
        self.emit('error', err);
        return;
      }

      for (var i = 0; i < result.length; i += 2) {
        // `result[i]` contains taskID, `result[i + 1]` contains its score
        if (self.__hasKnownWorker__(result[i])) {
          self.__retryReducing__(result[i], result[i + 1]);
        }
      }
    });
  });
};


// Init queue
//
Queue.prototype.__init__ = function () {
  var CHECK_INTERVAL = 500;
  var self = this;

  setTimeout(function () {
    self.__timer__ = setInterval(self.__tick__.bind(self), CHECK_INTERVAL);
  }, Math.round(Math.random() * CHECK_INTERVAL));

  // TODO: implement pub/sub
};

///////////////////////////////////////////////////////////////////////////////

module.exports = Queue;
module.exports.QueueError = QueueError;