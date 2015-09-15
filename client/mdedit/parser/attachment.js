'use strict';


var _ = require('lodash');


N.wire.once('init:parser', function attachment_plugin_init() {
  var sizes = '$$ JSON.stringify(N.config.users.uploads.resize) $$';

  var plugin = require('nodeca.core/lib/parser/plugins/attachment')(N, {
    types: '$$ JSON.stringify(N.models.users.MediaInfo.types) $$'
  });

  N.parse.addPlugin(
    'attachment',
    function (parser) {
      parser.bus.on('render', function fetch_attachment_data(data, callback) {
        if (!data.params.rpc_cache) {
          callback();
          return;
        }

        // find all images that point to an attachment and set data-nd-media-id attr
        data.ast.find('.image').each(function () {
          var $attach = $(this);
          var match = _.find(N.router.matchAll($attach.attr('src')), function (match) {
            return match.meta.methods.get === 'users.media';
          });

          if (!match) {
            return;
          }

          $attach.attr('data-nd-media-id', match.params.media_id);

          // Get a size from img alt attribute, e.g.:
          //  - ![md](link)
          //  - ![arbitrary text|md](link)
          //
          var alt = $attach.attr('alt') || '';
          var pos = alt.lastIndexOf('|');
          var size;

          if (pos !== -1) {
            size = alt.slice(pos + 1).trim();
            alt = alt.slice(0, pos);
          } else {
            size = alt.trim();
            alt = '';
          }

          if (sizes[size]) {
            $attach.attr('alt', alt);
          } else {
            size = 'sm';
          }

          $attach.data('nd-media-size', size);
        });

        // Fetch all images and calculate attach tail
        //
        var refs = [];

        data.ast.find('[data-nd-media-id]').map(function () {
          refs.push($(this).data('nd-media-id'));
        });

        var tail_ids = data.params.attachments.filter(function (media_id) {
          return refs.indexOf(media_id) === -1;
        });

        var result = data.params.rpc_cache.get('common.content.attachments', {
          ids: _.uniq(tail_ids.concat(refs)).sort()
        });

        if (!result) {
          data.ast.find('[data-nd-media-id]').each(function () {
            var $attach = $(this);

            $attach.data('nd-media-placeholder', true);
          });

          callback();
          return;
        }

        var attachments = result.attachments || {};

        data.ast.find('[data-nd-media-id]').each(function () {
          var $attach = $(this);
          var media_id = $attach.data('nd-media-id');

          if (!attachments[media_id]) { return; }

          $attach.data('nd-media-type', attachments[media_id].type);
          $attach.data('nd-media-filename', attachments[media_id].file_name);
        });

        data.result.tail = tail_ids.map(function (media_id) {
          if (!attachments[media_id]) { return null; }

          return _.omit({
            media_id:  media_id,
            type:      attachments[media_id].type,
            file_name: attachments[media_id].file_name
          }, _.isUndefined);
        }).filter(Boolean);

        callback();
      });


      plugin(parser);
    }
  );
});
