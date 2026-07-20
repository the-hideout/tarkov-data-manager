/**
 * unityRichTextToHtml.js
 *
 * Converts Unity Rich Text markup (the tag syntax used by Unity's UI Text
 * and TextMeshPro components) into HTML.
 *
 * Supported tags:
 *   <b>...</b>                      -> <strong>...</strong>
 *   <i>...</i>                      -> <em>...</em>
 *   <u>...</u>                      -> <u>...</u>
 *   <s>...</s>                      -> <s>...</s>
 *   <sup>...</sup>                  -> <sup>...</sup>
 *   <sub>...</sub>                  -> <sub>...</sub>
 *   <mark=#RRGGBBAA>...</mark>      -> <mark style="background-color:...">...</mark>
 *   <color=#RRGGBB>...</color>      -> <span style="color:#RRGGBB">...</span>
 *   <color=red>...</color>          -> <span style="color:red">...</span>
 *   <size=24>...</size>             -> <span style="font-size:24px">...</span>
 *   <size=150%>...</size>           -> <span style="font-size:150%">...</span>
 *   <align="right">...</align>      -> <div style="text-align:right">...</div>
 *   <width=75%>...</width>          -> <div style="width:75%">...</div>
 *   <line-height=150%>...</line-height> -> <div style="line-height:150%">...</div>
 *   <indent=10%>...</indent>        -> <div style="margin-left:10%">...</div>
 *   <voffset=5px>...</voffset>      -> <span style="position:relative;top:-5px">...</span>
 *   <nobr>...</nobr>                -> <span style="white-space:nowrap">...</span>
 *   <br>                            -> <br>
 *   \n (literal newline chars)      -> <br> (optional, on by default)
 *
 * Unrecognized tags are dropped by default (their inner content is kept),
 * or can optionally be passed through unchanged.
 *
 * Usage:
 *   const { unityRichTextToHtml } = require('./unityRichTextToHtml');
 *   const html = unityRichTextToHtml(unityString);
 */

'use strict';

// Tags that take no value and map directly to a wrapping HTML element.
const SIMPLE_TAGS = {
  b: 'strong',
  i: 'em',
  u: 'u',
  s: 's',
  sup: 'sup',
  sub: 'sub',
};

// Tags that take a value (e.g. <size=24>) and need custom open/close HTML.
// Each handler receives the raw attribute value (string, possibly with
// surrounding quotes already stripped) and returns { open, close }.
const VALUE_TAG_HANDLERS = {
  color: (val) => ({
    open: `<span style="color:${cssEscape(val)}">`,
    close: '</span>',
  }),
  mark: (val) => ({
    open: `<mark style="background-color:${cssEscape(val)}">`,
    close: '</mark>',
  }),
  size: (val) => {
    const size = /%$/.test(val) ? val : `${parseFloat(val) || 0}px`;
    return {
      open: `<span style="font-size:${size}">`,
      close: '</span>',
    };
  },
  align: (val) => ({
    open: `<div style="text-align:${cssEscape(val)}">`,
    close: '</div>',
  }),
  width: (val) => ({
    open: `<div style="width:${cssEscape(val)}">`,
    close: '</div>',
  }),
  'line-height': (val) => ({
    open: `<div style="line-height:${cssEscape(val)}">`,
    close: '</div>',
  }),
  indent: (val) => ({
    open: `<div style="margin-left:${cssEscape(val)}">`,
    close: '</div>',
  }),
  voffset: (val) => {
    const offset = /%$|px$/.test(val) ? val : `${parseFloat(val) || 0}px`;
    return {
      open: `<span style="position:relative;top:-${offset}">`,
      close: '</span>',
    };
  },
};

// Tags with no attribute that still need a custom wrapper.
const VALUELESS_CUSTOM_TAGS = {
  nobr: () => ({
    open: '<span style="white-space:nowrap">',
    close: '</span>',
  }),
};

// Matches an opening/closing Unity rich text tag, e.g.
//   <b>  </b>  <size=24>  <align="right">  <color=#5B5B59>
const TAG_REGEX = /<(\/?)([a-zA-Z-]+)(?:=(?:"([^"]*)"|([^>]*)))?\s*>/g;

function cssEscape(value) {
  // Strip characters that have no business in a CSS value; keeps
  // hex colors, percentages, named colors, and plain numbers intact.
  return String(value).replace(/["<>]/g, '').trim();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convert a Unity Rich Text markup string to an HTML string.
 *
 * @param {string} input - The Unity rich text markup.
 * @param {Object} [options]
 * @param {boolean} [options.convertNewlines=true] - Turn literal \n into <br>.
 * @param {boolean} [options.keepUnknownTags=false] - Pass unrecognized tags
 *        through unchanged instead of stripping them.
 * @returns {string} The converted HTML string.
 */
function unityRichTextToHtml(input, options = {}) {
  const { convertNewlines = true, keepUnknownTags = false } = options;

  if (typeof input !== 'string') {
    throw new TypeError('unityRichTextToHtml: input must be a string');
  }

  // Normalize escaped newlines (\\n as two chars) as well as real ones.
  let source = input.replace(/\\n/g, '\n');

  let html = '';
  let lastIndex = 0;
  let match;
  const openStack = []; // stack of { tagName, closeHtml }

  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(source)) !== null) {
    const [full, isClosing, rawTagName, quotedVal, bareVal] = match;
    const tagName = rawTagName.toLowerCase();
    const value = quotedVal !== undefined ? quotedVal : bareVal;

    // Append the plain text preceding this tag.
    const textChunk = source.slice(lastIndex, match.index);
    html += escapeHtml(textChunk);
    lastIndex = TAG_REGEX.lastIndex;

    if (!isClosing) {
      // Self-closing / void tags.
      if (tagName === 'br') {
        html += '<br>';
        continue;
      }

      let openHtml;
      let closeHtml;

      if (SIMPLE_TAGS[tagName]) {
        const el = SIMPLE_TAGS[tagName];
        openHtml = `<${el}>`;
        closeHtml = `</${el}>`;
      } else if (VALUE_TAG_HANDLERS[tagName] && value !== undefined) {
        const { open, close } = VALUE_TAG_HANDLERS[tagName](value);
        openHtml = open;
        closeHtml = close;
      } else if (VALUELESS_CUSTOM_TAGS[tagName]) {
        const { open, close } = VALUELESS_CUSTOM_TAGS[tagName]();
        openHtml = open;
        closeHtml = close;
      } else if (keepUnknownTags) {
        openHtml = full;
        closeHtml = `</${rawTagName}>`;
      } else {
        // Unknown tag: drop it, keep inner content.
        openHtml = '';
        closeHtml = '';
      }

      html += openHtml;
      openStack.push({ tagName, closeHtml });
    } else {
      // Closing tag: pop matching entry off the stack (tolerant of
      // mismatched/unclosed tags in the source, which Unity allows).
      const idx = findLastIndex(openStack, (e) => e.tagName === tagName);
      if (idx !== -1) {
        // Close everything opened after the matching tag too, in order,
        // then reopen anything that was closed prematurely is out of
        // scope here — Unity markup is almost always well-nested, so a
        // simple pop of the matched entry (and any tags above it) covers
        // real-world content.
        for (let i = openStack.length - 1; i >= idx; i--) {
          html += openStack[i].closeHtml;
        }
        openStack.length = idx;
      }
      // If there's no matching open tag, ignore the stray closing tag.
    }
  }

  // Append any trailing text after the last tag.
  html += escapeHtml(source.slice(lastIndex));

  // Close any tags left open at the end of the string.
  for (let i = openStack.length - 1; i >= 0; i--) {
    html += openStack[i].closeHtml;
  }

  if (convertNewlines) {
    html = html.replace(/\n/g, '<br>\n');
  }

  return html;
}

function findLastIndex(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

export default unityRichTextToHtml;
