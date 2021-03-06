// Markdown-it plugin to parse regular blockquotes and headed blockquotes
// (that's usually url followed by a blockquote):
//
//     http://foo.example.com/bar/baz
//     > this is an example text
//
// Renders to:
//
//     <blockquote cite="http://foo.example.com/bar/baz">
//     this is an example text
//     </blockquote>
//

'use strict';


module.exports = function plugin(md, options) {
  /* eslint-disable max-depth */
  var isSpace = md.utils.isSpace;

  function blockquote(state, startLine, endLine, silent) {
    var nextLine, lastLineEmpty, oldTShift, oldSCount, oldBMarks, oldIndent, oldParentType, lines, initial, offset, ch,
        terminatorRules, token, header,
        i, l, terminate,
        pos = state.bMarks[startLine] + state.tShift[startLine],
        max = state.eMarks[startLine];

    // check the block quote marker
    if (state.src.charCodeAt(pos++) !== 0x3E/* > */) {
      // headed blockquotes should never terminate anything
      if (silent) return false;

      // If not, check if the next line is a valid marker:
      //

      // we should have more than one line
      if (startLine >= endLine - 1) return false;

      // ... with no less indent
      if (state.sCount[nextLine] < oldIndent) return false;

      pos = state.bMarks[startLine + 1] + state.tShift[startLine + 1];
      max = state.eMarks[startLine + 1];

      if (state.src.charCodeAt(pos++) !== 0x3E/* > */) return false;

      // if we're here, than the next line is a valid blockquote,
      // maybe current one is a header?
      header = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
      header = header.replace(/\s*$/, '');

      if (!options.validate(header)) return false;

      startLine++;
    }

    // we know that it's going to be a valid blockquote,
    // so no point trying to find the end of it in silent mode
    if (silent) return true;

    // skip one optional space (but not tab, check cmark impl) after '>'
    if (state.src.charCodeAt(pos) === 0x20) { pos++; }

    oldIndent = state.blkIndent;
    state.blkIndent = 0;

    // skip spaces after ">" and re-calculate offset
    initial = offset = state.sCount[startLine] + pos - (state.bMarks[startLine] + state.tShift[startLine]);

    oldBMarks = [ state.bMarks[startLine] ];
    state.bMarks[startLine] = pos;

    // check if we have an empty blockquote
    pos = pos < max ? state.skipSpaces(pos) : pos;

    while (pos < max) {
      ch = state.src.charCodeAt(pos);

      if (isSpace(ch)) {
        if (ch === 0x09) {
          offset += 4 - offset % 4;
        } else {
          offset++;
        }
      } else {
        break;
      }

      pos++;
    }

    lastLineEmpty = pos >= max;

    oldSCount = [ state.sCount[startLine] ];
    state.sCount[startLine] = offset - initial;

    oldTShift = [ state.tShift[startLine] ];
    state.tShift[startLine] = pos - state.bMarks[startLine];

    terminatorRules = state.md.block.ruler.getRules('blockquote');

    // Search the end of the block
    //
    // Block ends with either:
    //  1. an empty line outside:
    //     ```
    //     > test
    //
    //     ```
    //  2. an empty line inside:
    //     ```
    //     >
    //     test
    //     ```
    //  3. another tag
    //     ```
    //     > test
    //      - - -
    //     ```
    for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      if (state.sCount[nextLine] < oldIndent) { break; }

      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (pos >= max) {
        // Case 1: line is not inside the blockquote, and this line is empty.
        break;
      }

      if (state.src.charCodeAt(pos++) === 0x3E/* > */) {
        // This line is inside the blockquote.

        // skip one optional space (but not tab, check cmark impl) after '>'
        if (state.src.charCodeAt(pos) === 0x20) { pos++; }

        // skip spaces after ">" and re-calculate offset
        initial = offset = state.sCount[nextLine] + pos - (state.bMarks[nextLine] + state.tShift[nextLine]);

        oldBMarks.push(state.bMarks[nextLine]);
        state.bMarks[nextLine] = pos;

        while (pos < max) {
          ch = state.src.charCodeAt(pos);

          if (isSpace(ch)) {
            if (ch === 0x09) {
              offset += 4 - offset % 4;
            } else {
              offset++;
            }
          } else {
            break;
          }

          pos++;
        }

        lastLineEmpty = pos >= max;

        oldSCount.push(state.sCount[nextLine]);
        state.sCount[nextLine] = offset - initial;

        oldTShift.push(state.tShift[nextLine]);
        state.tShift[nextLine] = pos - state.bMarks[nextLine];
        continue;
      }

      // Case 2: line is not inside the blockquote, and the last line was empty.
      if (lastLineEmpty) { break; }

      // Case 3: another tag found.
      terminate = false;
      for (i = 0, l = terminatorRules.length; i < l; i++) {
        if (terminatorRules[i](state, nextLine, endLine, true)) {
          terminate = true;
          break;
        }
      }
      if (terminate) { break; }

      oldBMarks.push(state.bMarks[nextLine]);
      oldTShift.push(state.tShift[nextLine]);
      oldSCount.push(state.sCount[nextLine]);

      // A negative indentation means that this is a paragraph continuation
      //
      state.sCount[nextLine] = -1;
    }

    oldParentType = state.parentType;
    state.parentType = 'blockquote';

    token        = state.push('headed_blockquote_open', 'blockquote', 1);
    token.markup = '>';
    token.info   = header || '';
    token.map    = lines = [ startLine, 0 ];

    state.md.block.tokenize(state, startLine, nextLine);

    token        = state.push('headed_blockquote_close', 'blockquote', -1);
    token.markup = '>';

    state.parentType = oldParentType;
    lines[1] = state.line;

    // Restore original tShift; this might not be necessary since the parser
    // has already been here, but just to make sure we can do that.
    for (i = 0; i < oldTShift.length; i++) {
      state.bMarks[i + startLine] = oldBMarks[i];
      state.tShift[i + startLine] = oldTShift[i];
      state.sCount[i + startLine] = oldSCount[i];
    }
    state.blkIndent = oldIndent;

    return true;
  }

  md.block.ruler.before('blockquote', 'headed_blockquote', blockquote, {
    alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
  });
  md.renderer.rules['headed_blockquote_open'] = options.render;
  md.renderer.rules['headed_blockquote_close'] = options.render;
};
