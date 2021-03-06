// Start image meta fetch
//

'use strict';


module.exports = function (N, apiPath) {
  N.validate(apiPath, {});

  N.wire.on(apiPath, async function image_sizes_fetch_start() {
    await N.models.core.ImageSizeCache.update(
      { status: N.models.core.ImageSizeCache.statuses.ERROR_RETRY },
      { $set: { status: N.models.core.ImageSizeCache.statuses.PENDING } },
      { multi: true }
    );

    await N.queue.image_sizes_fetch().run();
  });
};
