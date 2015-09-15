// Add editor instance to 'N' & emit event for plugins
//
'use strict';


var CodeMirror = require('codemirror');
var _          = require('lodash');
var Bag        = require('bag.js');
var RpcCache   = require('./_lib/rpc_cache')(N);


// Require markdown highlighter (mode) for CodeMirror
require('codemirror/mode/markdown/markdown');


var TEXT_MARGIN = 5;
var TOOLBAR = '$$ JSON.stringify(N.config.mdedit) $$';
var EMOJIS = '$$ JSON.stringify(N.config.parser.emojis) $$';


// Compile toolbar config
//
var compileToolbarConfig = _.memoize(function (name) {
  var buttonName;

  return _.reduce(TOOLBAR[name], function (result, buttonParams, key) {
    if (!buttonParams) {
      return result;
    }

    buttonName = key.indexOf('separator') === 0 ? 'separator' : key;

    if (buttonParams === true) {
      result.push(TOOLBAR.buttons[buttonName]);
    } else {
      result.push(_.defaults({}, buttonParams, TOOLBAR.buttons[buttonName]));
    }

    return result;
  }, []).sort(function (a, b) {
    return a.priority - b.priority;
  });
});


// Editor init
//
function MDEdit() {
  var self = this;

  this.emojis = EMOJIS;
  this.commands = {};
  this.__attachments__ = [];
  this.__options__ = null;
  this.__layout__ = null;
  this.__hotkeys__ = {};
  this.__minHeight__ = 0;
  this.__cm__ = null;
  this.__bag__ = new Bag({ prefix: 'nodeca_editor' });
  this.__scrollMap__ = null;
  this.__cache__ = new RpcCache();

  this.__cache__.on('update', function () {
    self.__updatePreview__();
  });
}


// Create new layout and show
//
// Options:
//
// - parseOptions (Object) - optional, object with plugins config like
//   `{ images: true, links: true, attachments: false }`, default `{}`
// - text (String) - optional, text, default empty string
// - attachments (Array) - optional, attachments, default empty array
// - toolbar (String) - optional, name of toolbar config, default `default`
//
// returns jQuery object
//
// Events:
//
// - `show.nd.mdedit` - before editor shown (when animation start)
// - `shown.nd.mdedit` - on editor shown
// - `hide.nd.mdedit` - before editor hide (when animation start)
// - `hidden.nd.mdedit` - on editor hide
// - `submit.nd.mdedit` - on done button press (if you want to prevent editor closing - call `event.preventDefault()`)
// - `change.nd.mdedit` - on update preview, you can save drafts on this event
//
MDEdit.prototype.show = function (options) {
  var self = this,
      $oldLayout = this.__layout__;

  this.__layout__ = $(N.runtime.render('mdedit'));
  this.__options__ = _.clone(options);
  this.__options__.toolbar = compileToolbarConfig(this.__options__.toolbar || 'default');
  this.__options__.parseOptions = this.__options__.parseOptions || {};

  self.__initCodeMirror__();

  // Get editor height from localstore
  this.__bag__.get('height', function (__, height) {

    if (height) {
      // If no prevoius editor - set `bottom` for animation
      if (!$oldLayout) {
        self.__layout__.css({ bottom: -height });
      }

      // Restore prevoius editor height
      self.__layout__.height(height);
    }

    $('body').append(self.__layout__);

    self.__cm__.setOption('extraKeys', {
      Esc:          function () { N.wire.emit('mdedit.cancel'); },
      'Ctrl-Enter': function () { N.wire.emit('mdedit.submit'); }
    });

    self.__initResize__();
    self.__initToolbar__();
    self.__initSyncScroll__();
    self.__initEmojis__();

    self.text(options.text || '');
    self.attachments(options.attachments || []);

    self.__layout__.trigger('show');

    // If no prevoius editor - animate editor from bottom viewport botder
    self.__layout__.animate({ bottom: 0 }, $oldLayout ? 0 : 'fast', function () {
      self.__layout__.trigger('shown');

      // Hide previous editor
      if ($oldLayout) {
        $oldLayout.trigger('hide');
        $oldLayout.trigger('hidden');
        $oldLayout.remove();
      }

      // Update codemirror height
      self.__cm__.setSize('100%', self.__layout__.find('.mdedit__edit-area').height());

      var $focusItem = self.__layout__.find('[tabindex=1]');

      if ($focusItem.length !== 0) {
        // Focus to element with tabindex = 1 if exists
        $focusItem.focus();
      } else {
        // Or focus to editor window
        self.__cm__.focus();
      }

      $(window).on('resize.nd.mdedit', self.__clampHeight__.bind(self));
    });
  });

  return this.__layout__;
};


// Hide editor
//
MDEdit.prototype.hide = function () {
  var self = this;
  var $layout = this.__layout__;

  if (!$layout) {
    return;
  }

  $(window).off('resize.nd.mdedit');

  setTimeout(function () {
    $layout.trigger('hide');
    $layout.animate({ bottom: -$layout.height() }, 'fast', function () {
      self.__layout__ = null;
      $layout.trigger('hidden');
      $layout.remove();
    });
  }, 0);
};


// Get/set text
//
MDEdit.prototype.text = function (text) {
  if (!text) {
    return this.__cm__.getValue();
  }

  this.__cm__.setValue(text);
  this.__cm__.setCursor(this.__cm__.lineCount(), 0);

  this.__updatePreview__();
};


// Get/set attachments
//
MDEdit.prototype.attachments = function (attachments) {
  if (!attachments) {
    return this.__attachments__;
  }

  this.__attachments__ = attachments;

  if (this.__attachments__.length === 0) {
    this.__layout__.addClass('mdedit__m-no-attachments');
  } else {
    this.__layout__.removeClass('mdedit__m-no-attachments');
  }

  this.__updatePreview__();
};


// Get/set parse options
//
MDEdit.prototype.parseOptions = function (parseOptions) {
  if (!parseOptions) {
    return this.__options__.parseOptions;
  }

  this.__options__.parseOptions = parseOptions;

  this.__initToolbar__();
  this.__updatePreview__();
};


// Set initial CodeMirror options
//
MDEdit.prototype.__initCodeMirror__ = function () {
  this.__cm__ = new CodeMirror(this.__layout__.find('.mdedit__edit-area').get(0), {
    cursorScrollMargin: TEXT_MARGIN,
    lineWrapping: true,
    lineNumbers: false,
    tabindex: 2,
    mode: 'markdown'
  });

  this.__cm__.on('change', this.__updatePreview__.bind(this));
};


// Init emojis select popup.
//
// Behaviour:
//
// - show when
//   - ':' typed at start of line or after space
//   - backspace typed and string before cursor finished to emoji start
// - hide when
//   - escape pressed
//   - editor lost focus
//   - cursor position changed
// - apply when
//   - enter or right arrow pressed
//   - click by emoji
//
MDEdit.prototype.__initEmojis__ = function () {
  var self = this;
  var $popup = this.__layout__.find('.emoji-autocomplete');

  // To check emoji start at line end (and extract emoji text)
  var emojiAtEndRE = /(?:^|\s):([^:\s]*)$/;


  // Show or update popup
  //
  function showPopup(text) {
    var emojis = {};

    // Filter emijis by text (but not more than 5)
    _.forEach(self.emojis.named, function (val, name) {
      if (name.indexOf(text) !== -1) {
        emojis[name] = val;
      } else {
        return true; // continue
      }

      if (Object.keys(emojis).length >= 5) {
        return false; // break;
      }
    });

    // If nothing found - hide popup
    if (Object.keys(emojis).length === 0) {
      $popup.removeClass('emoji-autocomplete__m-visible');
      return;
    }

    // Render emojis list
    $popup.html(N.runtime.render('mdedit.emoji_autocomplete', { emojis: emojis, search: text }));

    // Should be called after cursor position change (after event propagation finish)
    setTimeout(function () {
      // Show popup
      $popup.addClass('emoji-autocomplete__m-visible');

      var $cursor = self.__layout__.find('.CodeMirror-cursor');
      var layoutOffset = self.__layout__.offset();
      var cursorOffset = $cursor.offset();
      var layoutPadding = parseInt(self.__layout__.css('padding-right'), 10);
      var top = cursorOffset.top - layoutOffset.top - $popup.height();
      var left = cursorOffset.left - layoutOffset.left;

      // If popup outside right editor edge - attach it to right edge
      if (left + $popup.outerWidth() > layoutOffset.left + self.__layout__.outerWidth() - layoutPadding) {
        left = (layoutOffset.left + self.__layout__.outerWidth() - layoutPadding) - $popup.outerWidth();
      }

      // If popup outside top editor edge - move it under cursor
      if (top < 0) {
        top = cursorOffset.top - layoutOffset.top + $cursor.outerHeight();
      }

      // Set popup position above cursor
      $popup.css({ top: top, left: left });
    }, 0);
  }


  // Insert emoji to editor area and hide popup
  //
  function insert(emoji) {
    var curEnd = self.__cm__.getCursor();
    var line = self.__cm__.getDoc().getLine(curEnd.line);

    // Find nearest ':' symbol before cursor
    var curBegin = { ch: _.lastIndexOf(line, ':', curEnd.ch), line: curEnd.line };

    if (curBegin.ch === -1) {
      curBegin.ch = 0;
    }

    self.__cm__.replaceRange(':' + emoji + ':', curBegin, curEnd);
    $popup.removeClass('emoji-autocomplete__m-visible');
    self.__cm__.focus();
  }


  // Show or hide popup if text changed
  //
  this.__cm__.on('change', function (editor, changeObj) {
    if (!self.__options__.parseOptions.emoji) {
      // Stop here if emoji disabled
      return;
    }

    var poputShown = $popup.hasClass('emoji-autocomplete__m-visible');
    var cursor = editor.getCursor();
    // Get line before cursor
    var line = editor.getDoc().getLine(cursor.line).substr(0, cursor.ch);

    if (!emojiAtEndRE.test(line)) {
      if (poputShown) {
        $popup.removeClass('emoji-autocomplete__m-visible');
      }
      return;
    }

    var emojiText = line.match(emojiAtEndRE)[1];

    if (changeObj.origin === '+input') {
      if (poputShown) {
        // Update popup if already shown
        showPopup(emojiText);
      } if (emojiText === '') {
        // Show popup if ':' typed
        showPopup(emojiText);
      }
      return;
    }

    if (changeObj.origin === '+delete') {
      // Show popup if backspace pressed and line match pattern
      showPopup(emojiText);
    }
  });


  // Hide or update popup if cursor position changed (can be done with mouse, touch or left arrow)
  //
  this.__cm__.on('cursorActivity', function () {
    if (!$popup.hasClass('emoji-autocomplete__m-visible')) {
      return;
    }

    if (self.__cm__.somethingSelected()) {
      $popup.removeClass('emoji-autocomplete__m-visible');
      return;
    }

    var cursor = self.__cm__.getCursor();
    var line = self.__cm__.getDoc().getLine(cursor.line).substr(0, cursor.ch);

    if (!emojiAtEndRE.test(line)) {
      $popup.removeClass('emoji-autocomplete__m-visible');
      return;
    }

    showPopup(line.match(emojiAtEndRE)[1]);
  });


  // Insert emoji to text if clicked. We should use `mousedown` instead of `click`
  // because `click` could be canceled (if mouseup event cause when popup invisible)
  //
  $popup.on('mousedown touchstart', '.emoji-autocomplete-item__link', function () {
    insert($(this).data('value'));

    return false;
  });


  // Handle keypress if popup shown
  //
  this.__cm__.on('keydown', function (editor, event) {
    if (!$popup.hasClass('emoji-autocomplete__m-visible')) {
      return;
    }

    // `keyCode` for IE, `which` for others
    var code = event.which || event.keyCode;
    var $item;
    var $selected;

    switch (code) {
      // Up - select previous popup list item
      case 38:
        $selected = $popup.find('.emoji-autocomplete-item__m-selected');
        $item = $popup.find('.emoji-autocomplete-item:nth-child(' + ((1 + $selected.index()) - 1) + ')');

        if ($item.length) {
          $selected.removeClass('emoji-autocomplete-item__m-selected');
          $item.addClass('emoji-autocomplete-item__m-selected');
        }
        break;

      // Down - select next popup list item
      case 40:
        $selected = $popup.find('.emoji-autocomplete-item__m-selected');
        $item = $popup.find('.emoji-autocomplete-item:nth-child(' + ((1 + $selected.index() + 1)) + ')');

        if ($item.length) {
          $selected.removeClass('emoji-autocomplete-item__m-selected');
          $item.addClass('emoji-autocomplete-item__m-selected');
        }
        break;

      // Enter or right - insert current emoji
      case 13:
      case 39:
        $selected = $popup.find('.emoji-autocomplete-item__m-selected .emoji-autocomplete-item__link');
        insert($selected.data('value'));

        break;

      // Esc - hide popup
      case 27:
        $popup.removeClass('emoji-autocomplete__m-visible');
        break;

      default:
        return;
    }

    event.preventDefault();
  });


  // Hide popup if focus lost
  //
  this.__cm__.on('blur', function () {
    // Wait 50 ms before hide popup to allow click by popup item
    setTimeout(function () {
      if (!$popup.hasClass('emoji-autocomplete__m-visible')) {
        return;
      }

      $popup.removeClass('emoji-autocomplete__m-visible');
    }, 50);
  });
};


// Add editor resize handler
//
MDEdit.prototype.__initResize__ = function () {
  var self = this,
      $body = $('body'),
      $window = $(window);

  // load min-height limit & reset it to enable animation
  self.__minHeight__ = parseInt(this.__layout__.css('minHeight'), 10);
  self.__layout__.css('minHeight', 0);

  self.__layout__.height(self.__layout__.height());

  self.__clampHeight__();

  this.__layout__.find('.mdedit__resizer').on('mousedown touchstart', function (event) {
    var clickStart = event.originalEvent.touches ? event.originalEvent.touches[0] : event;
    var currentHeight = parseInt(self.__layout__.height(), 10);

    self.__layout__.addClass('mdedit__m-resizing');

    $body
      .on('mouseup.nd.mdedit touchend.nd.mdedit', function () {
        $body.off('.nd.mdedit');
        self.__layout__.removeClass('mdedit__m-resizing');
      })
      .on('mousemove.nd.mdedit touchmove.nd.mdedit', _.debounce(function (event) {
        var point = event.originalEvent.touches ? event.originalEvent.touches[0] : event,
            newHeight = currentHeight - (point.pageY - clickStart.pageY),
            winHeight = $window.height();

        newHeight = newHeight > winHeight ? winHeight : newHeight;
        newHeight = newHeight < self.__minHeight__ ? self.__minHeight__ : newHeight;

        self.__bag__.set('height', newHeight);
        self.__layout__.height(newHeight);
        self.__cm__.setSize('100%', self.__layout__.find('.mdedit__edit-area').height());
      }, 20, { maxWait: 20 }));

    return false;
  });
};


// Reduce size on small viewports
//
MDEdit.prototype.__clampHeight__ = _.debounce(function () {
  var winHeight = $(window).height();

  if (this.__layout__.height() > winHeight &&
      winHeight >= this.__minHeight__) {
    this.__layout__.height(winHeight);
    this.__cm__.setSize('100%', this.__layout__.find('.mdedit__edit-area').height());
  }
}, 50, { maxWait: 50 });


// Init scroll listeners to synchronize position between editor and preview
//
MDEdit.prototype.__initSyncScroll__ = function () {
  var self = this;
  var $preview = this.__layout__.find('.mdedit__preview');
  var $editor = this.__layout__.find('.CodeMirror-scroll');
  var editorScroll, previewScroll;


  // When user resize window - remove outdated scroll map
  $(window).on('resize.nd.mdedit', function () {
    self.__scrollMap__ = null;
  });


  // Editor scroll handler
  //
  editorScroll = _.debounce(function () {
    if (!self.__scrollMap__) {
      self.__buildScrollMap__();
    }

    // Get top visible editor line number
    var lh = parseInt(self.__layout__.find('.CodeMirror-code > pre:first').css('lineHeight'), 10);
    var line = Math.round(self.__cm__.getScrollInfo().top / lh);
    // Get preview offset
    var posTo = self.__scrollMap__[line];

    // Remove scroll handler for preview when scroll it programmatically
    $preview.off('scroll.nd.mdedit');

    $preview.stop(true).animate({ scrollTop: posTo }, 'fast', 'linear', function () {
      // Restore scroll handler after 50 ms delay to avoid non-user scroll events
      setTimeout(function () {
        $preview.on('scroll.nd.mdedit', previewScroll);
      }, 50);
    });
  }, 50, { maxWait: 50 });


  // Preview scroll handler
  //
  previewScroll = _.debounce(function () {
    if (!self.__scrollMap__) {
      self.__buildScrollMap__();
    }

    var scrollTop = $preview.scrollTop();
    var line;

    // Get editor line number by preview offset
    for (line = 0; line < self.__scrollMap__.length; line++) {
      if (self.__scrollMap__[line] >= scrollTop) {
        break;
      }
    }

    var lh = parseInt(self.__layout__.find('.CodeMirror-code > pre:first').css('lineHeight'), 10);
    var posTo = line * lh;

    // Remove scroll handler for editor when scroll it programmatically
    $editor.off('scroll.nd.mdedit');

    $editor.stop(true).animate({ scrollTop: posTo }, 'fast', 'linear', function () {
      // Restore scroll handler after 50 ms delay to avoid non-user scroll events
      setTimeout(function () {
        $editor.on('scroll.nd.mdedit', editorScroll);
      }, 50);
    });
  }, 50, { maxWait: 50 });


  // Bind events
  $editor.on('scroll.nd.mdedit', editorScroll);
  $preview.on('scroll.nd.mdedit', previewScroll);
};


// Build offsets for each line
//
MDEdit.prototype.__buildScrollMap__ = function () {
  var $preview = this.__layout__.find('.mdedit__preview'),
      offset = $preview.offset().top - $preview.scrollTop(),
      mappedLinesNumbers = [],
      lineHeightMap = [],
      scrollMap = [],
      lineCount = 0,
      pos = 0,
      line, $el, lh, i, a, b;

  // Calculate wrapped lines count and fill map real->wrapped
  lh = parseInt(this.__layout__.find('.CodeMirror-code > pre:first').css('lineHeight'), 10);
  this.__cm__.eachLine(function (lineHandle) {
    lineHeightMap.push(lineCount);
    lineCount += lineHandle.height / lh;
  });

  // Init `scrollMap` array
  for (i = 0; i < lineCount; i++) {
    scrollMap.push(-1);
  }

  // Define first line offset
  mappedLinesNumbers.push(0);
  scrollMap[0] = 0;

  // Get mapped lines offsets and fill mapped lines numbers
  this.__layout__.find('.mdedit__preview > [data-line]').each(function () {
    $el = $(this);
    line = lineHeightMap[$el.data('line')];

    if (line === 0) {
      return;
    }

    scrollMap[line] = $el.offset().top - offset;

    if (line !== lineCount - 1) {
      mappedLinesNumbers.push(line);
    }
  });

  // Define last line offset
  scrollMap[lineCount - 1] = $preview.get(0).scrollHeight;
  mappedLinesNumbers.push(lineCount - 1);

  // Interpolate offset of lines between mapped lines
  for (i = 0; i < scrollMap.length; i++) {
    if (scrollMap[i] !== -1) {
      pos++;
      continue;
    }

    a = mappedLinesNumbers[pos - 1];
    b = mappedLinesNumbers[pos];

    scrollMap[i] = Math.round((scrollMap[b] * (i - a) + scrollMap[a] * (b - i)) / (b - a));
  }

  this.__scrollMap__ = scrollMap;
};


// Update attachments, preview and save draft
//
MDEdit.prototype.__updatePreview__ = _.debounce(function () {
  var self = this;

  if (!self.__layout__) { return; }

  self.__layout__.trigger('change');

  N.parse(
    {
      text: this.text(),
      attachments: this.attachments().map(function (attach) {
        return attach.media_id;
      }),
      options: this.__options__.parseOptions,
      rpc_cache: self.__cache__
    },
    function (err, result) {
      if (err) {
        // It should never happen
        N.wire.emit('notify', { type: 'error', message: err.message });
        return;
      }

      if (!self.__layout__) { return; }

      self.__layout__.find('.mdedit__preview').html(N.runtime.render('mdedit.preview', {
        user_hid: N.runtime.user_hid,
        html: result.html,
        attachments: result.tail
      }));

      self.__layout__.find('.mdedit-attachments').html(N.runtime.render('mdedit.attachments', {
        attachments: self.attachments()
      }));

      self.__scrollMap__ = null;
    }
  );
}, 500, { maxWait: 500, leading: true });


// Update toolbar button list
//
MDEdit.prototype.__initToolbar__ = function () {
  var self = this;
  var $toolbar = this.__layout__.find('.mdedit__toolbar');

  if (this.__toolbarHotkeys__) {
    this.__cm__.removeKeyMap(this.__toolbarHotkeys__);
  }

  // Get actual buttons
  var buttons = _.reduce(this.__options__.toolbar, function (result, btn) {

    // If parser plugin inactive - remove button
    if (self.__options__.parseOptions[btn.depend] === false) {
      return result;
    }

    // If duplicate separator - remove it
    if (btn.separator && result.length > 0 && result[result.length - 1].separator) {
      return result;
    }

    result.push(btn);

    return result;
  }, []);

  // If first item is separator - remove
  if (buttons.length > 0 && buttons[0].separator) {
    buttons.shift();
  }

  // If last item is separator - remove
  if (buttons.length > 0 && buttons[buttons.length - 1].separator) {
    buttons.pop();
  }

  // Render toolbar
  $toolbar.html(N.runtime.render('mdedit.toolbar', {
    buttons: buttons
  }));

  // Process hotkeys for editor
  this.__toolbarHotkeys__ = buttons.reduce(function (result, button) {
    if (!button.command || !button.bind_key || !self.commands[button.command]) {
      return result;
    }

    _.forEach(button.bind_key, function (bindKey) {
      result[bindKey] = function () {
        self.commands[button.command](self.__cm__);
      };
    });

    return result;
  }, {});

  // Enable active button's hotkeys
  this.__cm__.addKeyMap(this.__toolbarHotkeys__);
};


// Toolbar button click
//
N.wire.on('mdedit.toolbar:click', function toolbar_click(data) {
  var command = N.MDEdit.commands[data.$this.data('command')].bind(N.MDEdit);

  if (command) {
    command(N.MDEdit.__cm__);

    // Restore focus on editor after command execution
    N.MDEdit.__cm__.focus();
  }
});


// Attachment click
//
N.wire.on('mdedit.attachments:insert', function attachments_insert(data) {
  var url = N.router.linkTo('users.media', { user_hid: N.runtime.user_hid, media_id: data.$this.data('media-id') });
  var cm = N.MDEdit.__cm__;

  cm.replaceRange('![](' + url + ')', cm.getCursor(), cm.getCursor());
  cm.focus();

  data.event.stopPropagation();
});


// Remove attachment
//
N.wire.on('mdedit.attachments:remove', function attachments_insert(data) {
  var id = data.$this.data('media-id');
  var attachments = N.MDEdit.attachments();

  attachments = _.remove(attachments, function (val) { return val.media_id !== id; });
  N.MDEdit.attachments(attachments);
  data.event.stopPropagation();
});


// Done handler
//
N.wire.on('mdedit.submit', function done_click() {
  var event = new $.Event('submit');

  N.MDEdit.__layout__.trigger(event);

  if (!event.isDefaultPrevented()) {
    N.MDEdit.hide();
  }
});


// Hide when escape key is pressed
//
N.wire.on('event.keypress.escape', function mdedit_close() {
  N.MDEdit.hide();
});


// Hide on cancel
//
N.wire.on('mdedit.cancel', function close() {
  N.MDEdit.hide();
});


// Collapse/expand editor
//
N.wire.on('mdedit.collapse', function collapse() {
  var $layout = N.MDEdit.__layout__;

  // Expand
  if ($layout.hasClass('mdedit__m-collapsed')) {
    $layout.removeClass('mdedit__m-collapsed');

  // Collapse
  } else {
    $layout.addClass('mdedit__m-collapsed');
  }
});


// Dragdrop file to editor
//
N.wire.on('mdedit:dd', function mdedit_dd(data) {
  var $layout = N.MDEdit.__layout__;
  var x0, y0, x1, y1, ex, ey, uploaderData;

  switch (data.event.type) {
    case 'dragenter':
      $layout.addClass('mdedit__m-active');
      break;
    case 'dragleave':
      // 'dragleave' occurs when user move cursor over child HTML element
      // track this situation and don't remove 'active' class
      // http://stackoverflow.com/questions/10867506/
      x0 = $layout.offset().left;
      y0 = $layout.offset().top;
      x1 = x0 + $layout.outerWidth();
      y1 = y0 + $layout.outerHeight();
      ex = data.event.originalEvent.pageX;
      ey = data.event.originalEvent.pageY;

      if (ex > x1 || ex < x0 || ey > y1 || ey < y0) {
        $layout.removeClass('mdedit__m-active');
      }
      break;
    case 'drop':
      $layout.removeClass('mdedit__m-active');

      if (data.event.dataTransfer && data.event.dataTransfer.files && data.event.dataTransfer.files.length) {

        uploaderData = {
          files: data.event.dataTransfer.files,
          url: N.router.linkTo('users.media.upload'),
          config: 'users.uploader_config',
          uploaded: null
        };

        N.wire.emit('users.uploader:add', uploaderData, function () {
          var attachments = N.MDEdit.attachments();

          uploaderData.uploaded.forEach(function (media) {
            attachments.unshift(_.pick(media, [ 'media_id', 'file_name', 'type' ]));
          });

          N.MDEdit.attachments(attachments);
        });
      }
      break;
    default:
  }
});


// Add editor instance to 'N' & emit event for plugins
//
N.wire.once('init:assets', function (__, callback) {
  N.MDEdit = new MDEdit();

  N.wire.emit('init:mdedit', {}, callback);
});
