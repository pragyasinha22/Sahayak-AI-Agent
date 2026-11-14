/**
 * Sahayak — YouTube URL parser (Slice 1.6.1)
 * -----------------------------------------------------------------------------
 * PS §2.5 / Plan Slice 1.6.1: "parse YouTube URLs (watch, youtu.be, shorts)
 * and validate video ids". PURE module — no chrome.*, no DOM — shared by the
 * Side Panel feature (panel/features/youtube.js) and unit tests
 * (tests/unit/youtube.test.js).
 *
 * Rules:
 *   - Accepted shapes: youtube.com/watch?v=ID, youtu.be/ID,
 *     youtube.com/shorts/ID, youtube.com/embed/ID, youtube.com/live/ID.
 *   - A video id is exactly 11 chars of [A-Za-z0-9_-] (YouTube's published
 *     format). Anything else — including non-YouTube hosts, youtube.com
 *     without an id, or ids embedded in longer junk paths — is rejected so
 *     callers can show the PS §2.5 "cannot be summarised" refusal instead of
 *     sending the panel to a wrong page.
 *   - Only PUBLIC watch URLs are rebuilt (canonical
 *     https://www.youtube.com/watch?v=ID); the adapter then decides whether a
 *     transcript is "available" (Plan EC handling: private/unlisted/remove
 *     -> graceful refusal, never a crash).
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  var YOUTUBE_HOSTS = {
    'youtube.com': true,
    'www.youtube.com': true,
    'm.youtube.com': true,
    'music.youtube.com': true,
    'youtu.be': true
  };

  /**
   * parseYouTubeUrl(url) ->
   *   { ok: true, videoId, kind, canonicalUrl }   kind: watch|shorts|embed|live|be
   *   { ok: false, reason: 'empty'|'not-url'|'not-youtube'|'no-video-id'|'bad-video-id' }
   */
  function parseYouTubeUrl(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      return { ok: false, reason: 'empty' };
    }
    var u;
    try {
      u = new URL(url.trim());
    } catch (_) {
      return { ok: false, reason: 'not-url' };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { ok: false, reason: 'not-youtube' };
    }
    var host = u.hostname.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(YOUTUBE_HOSTS, host)) {
      return { ok: false, reason: 'not-youtube' };
    }

    var id = '';
    var kind = '';
    if (host === 'youtu.be') {
      id = u.pathname.replace(/^\//, '').split('/')[0];
      kind = 'be';
    } else {
      var seg = u.pathname.split('/').filter(Boolean);
      if (seg[0] === 'watch') {
        id = u.searchParams.get('v') || '';
        kind = 'watch';
      } else if (seg[0] === 'shorts' || seg[0] === 'embed' || seg[0] === 'live') {
        id = seg[1] || '';
        kind = seg[0];
      }
    }

    if (!id) return { ok: false, reason: 'no-video-id' };
    if (!VIDEO_ID.test(id)) return { ok: false, reason: 'bad-video-id' };

    return {
      ok: true,
      videoId: id,
      kind: kind,
      canonicalUrl: 'https://www.youtube.com/watch?v=' + id
    };
  }

  function isYouTubeUrl(url) {
    return parseYouTubeUrl(url).ok === true;
  }

  var api = {
    VIDEO_ID: VIDEO_ID,
    parseYouTubeUrl: parseYouTubeUrl,
    isYouTubeUrl: isYouTubeUrl
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakYouTubeUrl = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
