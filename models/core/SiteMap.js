'use strict';


const Mongoose = require('mongoose');
const Schema   = Mongoose.Schema;
const Promise  = require('bluebird');


module.exports = function (N, collectionName) {

  let SiteMap = new Schema({
    files:    [ String ],
    active:   { type: Boolean, 'default': false }
  }, {
    versionKey: false
  });


  // Indexes
  //////////////////////////////////////////////////////////////////////////////


  // Remove sitemap files
  //
  SiteMap.pre('remove', function remove_sitemap_files(callback) {
    Promise.all(this.files.map(fileid => N.models.core.FileTmp.remove(fileid)))
      .asCallback(callback);
  });


  N.wire.on('init:models', function emit_init_SiteMap() {
    return N.wire.emit('init:models.' + collectionName, SiteMap);
  });


  N.wire.on('init:models.' + collectionName, function init_model_SiteMap(schema) {
    N.models[collectionName] = Mongoose.model(collectionName, schema);
  });
};
