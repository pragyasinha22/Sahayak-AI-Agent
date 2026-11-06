/**
 * Sahayak — YouTube page adapter (Slice 1.6.1)
 * -----------------------------------------------------------------------------
 * PS §2.5 / Plan Slice 1.6.1: "adapter extracts video id + available
 * transcript/timestamps from the page". Injected ON DEMAND (same activeTab +
 * scripting pattern as Slice 1.4.1) when the user presses Summarise on a
 * YouTube watch page, and answers the SAME sanctioned `extract-article`
 * family as the article adapter — deliberately: the message contract keeps
 * its fixed Week-1 families (GDR-6) and the router/gate stay untouched, while
 * `kind: 'youtube'` tells the panel which shape came back.
 *
 * Data gathered (best-effort; every step is try/catch-wrapped):
 *   - videoId   from <link rel="canonical"> via shared/youtube-url.js
 *   - title     from <title>/og:title
 *   - byline    from the channel name element when present
 *   - chapters  timestamp lines ("1:02 topic") from the description text
 *   - transcript from the caption track the page already loaded
 *                (baseUrl found inside the inline ytInitialPlayerResponse
 *                script text — isolated worlds can read DOM text, not page
 *                JS variables; the timedtext fetch is SAME-ORIGIN youtube.com,
 *                so no host permission beyond activeTab is used).
 *
 * When no transcript AND no chapter timestamps exist (private/unlisted/
 * removed/subtitle-less videos) the adapter returns
 * { ok:false, error:'no-transcript' } so the panel shows the plan's
 * "cannot be summarised" message — a graceful refusal, never a crash, never
 * a guessed summary (EC: unavailable transcript).
 *
 * Privacy: GDR-7 / INV-5 — the result is a WHITELISTED, plain-text object
 * (id/title/byline/transcript/chapters). No HTML, no cookies, no viewer data
 * ever leaves the page; only this object is returned to the extension.
 *
 * Pure helpers are exported under CommonJS for tests/unit/youtube.test.js;
 * the listener below self-registers only in the browser (idempotent across
 * repeat injections via a window flag).
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var MAX_TRANSCRIPT_CHARS = 30000; // provider-size bound (mirrors 40k article cap)

  // --------------------------------------------------------------------------
  // Pure helpers (Node-testable).
  // --------------------------------------------------------------------------
  function msToClock(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var s = t % 60;
    var m = Math.floor(t / 60) % 60;
    var h = Math.floor(t / 3600);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h > 0 ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }

  var CHAPTER_LINE =
    /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-\u2013\u2014:]?\s+(\S.*)$/;

  /** 'mm:ss' / 'h:mm:ss' — the SS hop must be <60 so '12:99' is prose, not a time. */
  function validClock(time) {
    var parts = String(time).split(':');
    if (parts.length < 2 || parts.length > 3) return false;
    var secs = parseInt(parts[parts.length - 1], 10);
    if (isNaN(secs) || secs < 0 || secs > 59) return false;
    if (parts.length === 3) {
      var mins = parseInt(parts[1], 10);
      if (isNaN(mins) || mins < 0 || mins > 59) return false;
    }
    return true;
  }

  /** Parses "1:02 intro / 12:33 — deep work" style description lines. */
  function parseChapterLines(text) {
    if (typeof text !== 'string' || text.trim() === '') return [];
    var out = [];
    var seen = {};
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var m = CHAPTER_LINE.exec(lines[i]);
      if (!m || !validClock(m[1])) continue;
      if (seen[m[1]]) continue; // first occurrence per timestamp
      seen[m[1]] = true;
      out.push({ time: m[1], label: m[2].trim() });
      if (out.length >= 50) break; // sane chapter cap
    }
    return out;
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /** json3 caption events -> [{ start, text }] (defensive to any shape). */
  function parseCaptionEvents(json3) {
    var out = [];
    if (!json3 || !Array.isArray(json3.events)) return out;
    var events = json3.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var segs = ev && Array.isArray(ev.segs) ? ev.segs : null;
      if (!segs) continue;
      var text = '';
      for (var j = 0; j < segs.length; j++) {
        if (typeof segs[j].utf8 === 'string') text += segs[j].utf8;
      }
      text = decodeEntities(text).replace(/\s+/g, ' ').trim();
      if (!text || text === '[Music]') continue;
      out.push({ start: msToClock(ev.tStartMs || 0), text: text });
    }
    return out;
  }

  /** Transcript lines -> "[mm:ss] text" block, clamped (EC oversized input). */
  function formatTranscript(lines, max) {
    var limit = (typeof max === 'number' && max > 0) ? max : MAX_TRANSCRIPT_CHARS;
    var src = Array.isArray(lines) ? lines : [];
    var text = '';
    var truncated = false;
    for (var i = 0; i < src.length; i++) {
      var l = src[i];
      if (!l || typeof l.text !== 'string' || typeof l.start !== 'string') continue;
      var next = (text ? text + '\n' : '') + '[' + l.start + '] ' + l.text;
      if (next.length > limit) { truncated = true; break; }
      text = next;
    }
    return { text: text, truncated: truncated };
  }

  /**
   * Whitelisted result builder. ok requires a transcript OR chapters;
   * otherwise the plan's graceful no-transcript refusal.
   */
  function buildYouTubeResult(input) {
    var v = input || {};
    var transcript = (typeof v.transcriptText === 'string') ? v.transcriptText.trim() : '';
    var chapters = Array.isArray(v.chapters) ? v.chapters : [];
    if (!transcript && chapters.length === 0) {
      return {
        ok: false,
        error: 'no-transcript',
        message: 'This video has no available transcript or chapter timestamps.'
      };
    }
    return {
      ok: true,
      kind: 'youtube',
      videoId: (typeof v.videoId === 'string') ? v.videoId : '',
      title: (typeof v.title === 'string') ? v.title : '',
      byline: (typeof v.byline === 'string') ? v.byline : '',
      hasTranscript: transcript !== '',
      chapters: chapters,
      textContent: transcript ||
        chapters.map(function (c) { return '[' + c.time + '] ' + c.label; }).join('\n'),
      truncated: !!v.truncated
    };
  }

  // --------------------------------------------------------------------------
  // Browser wiring (isolated world). Everything is best-effort.
  // --------------------------------------------------------------------------
  function findCaptionBaseUrl(doc) {
    // The inline scripts hold ytInitialPlayerResponse = {...}; isolated worlds
    // cannot read the variable but CAN read the script's text. Scan for the
    // first caption track baseUrl (JSON-escaped string) and unescape it.
    try {
      var scripts = doc.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var txt = scripts[i].textContent || '';
        if (txt.indexOf('ytInitialPlayerResponse') === -1) continue;
        var m = /"baseUrl":"((?:[^"\\]|\\.)*)"/.exec(txt);
        if (!m) continue;
        try {
          var url = JSON.parse('"' + m[1] + '"');
          if (typeof url === 'string' && url.indexOf('http') === 0) return url;
        } catch (_) { /* malformed escape; keep scanning */ }
      }
    } catch (_) { /* DOM access failed */ }
    return '';
  }

  function readVideoId(doc) {
    try {
      var link = doc.querySelector('link[rel="canonical"]');
      var href = link && link.getAttribute('href');
      if (href && global.SahayakYouTubeUrl) {
        var parsed = global.SahayakYouTubeUrl.parseYouTubeUrl(href);
        if (parsed.ok) return { videoId: parsed.videoId, url: href };
      }
      var m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(doc.URL || '');
      if (m) return { videoId: m[1], url: doc.URL };
    } catch (_) { /* ignore */ }
    return null;
  }

  function readTitle(doc) {
    try {
      var og = doc.querySelector('meta[property="og:title"]');
      if (og && og.content) return String(og.content);
      var t = doc.title || '';
      return t.replace(/\s*-\s*YouTube\s*$/, '');
    } catch (_) { return ''; }
  }

  function readByline(doc) {
    try {
      var el = doc.querySelector('ytd-channel-name #text, #channel-name, a[href^="/@"] span');
      if (el && el.textContent) return String(el.textContent).trim();
    } catch (_) { /* ignore */ }
    return '';
  }

  function readDescription(doc) {
    try {
      var el = doc.querySelector('#description-inline-expander, #description, yt-attributed-string');
      return el ? String(el.innerText || el.textContent || '') : '';
    } catch (_) { return ''; }
  }
  //   --------------------------------------------------
  
  // Read transcript segments from YouTube's rendered transcript panel.
  // YouTube may render these inside open Shadow DOM roots, so search those too.
  function getTranscriptSearchRoots(doc) {
    var roots = [doc];
    var seen = [doc];

    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      var elements = [];

      try {
        elements = root.querySelectorAll('*');
      } catch (_) {
        continue;
      }

      for (var j = 0; j < elements.length; j++) {
        var shadow = elements[j] && elements[j].shadowRoot;
        if (shadow && seen.indexOf(shadow) === -1) {
          seen.push(shadow);
          roots.push(shadow);
        }
      }
    }

    return roots;
  }

  function nodeText(node) {
    if (!node) return '';
    return String(node.innerText || node.textContent || '').trim();
  }

  function firstMatchingText(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var nodes = root.querySelectorAll(selectors[i]);
        for (var j = 0; j < nodes.length; j++) {
          var value = nodeText(nodes[j]);
          if (value) return value;
        }
      } catch (_) {
        // A selector may not exist in this YouTube layout.
      }
    }
    return '';
  }

  function parseTranscriptTimestamp(value) {
    var match = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\b/.exec(value || '');
    if (!match) return '';

    var parts = match[1].split(':');
    var seconds = Number(parts[parts.length - 1]);

    if (!Number.isInteger(seconds) || seconds > 59) return '';

    if (parts.length === 3) {
      var minutes = Number(parts[1]);
      if (!Number.isInteger(minutes) || minutes > 59) return '';
    }

    return match[1];
  }

  /**
   * Extract timestamped text from YouTube's rendered transcript panel.
   * Supports the older ytd-transcript-segment-renderer and newer
   * transcript-segment-view-model layouts.
   *
   * Returns [{ start: '0:01', text: '...' }].
   */
  function readTranscriptPanel(doc) {
    var roots = getTranscriptSearchRoots(doc);
    var selectors = [
      'ytd-transcript-segment-renderer',
      'yt-transcript-segment-renderer',
      'transcript-segment-view-model'
    ];

    var timestampSelectors = [
      '#segment-timestamp',
      '.segment-timestamp',
      '[class*="segment-timestamp"]',
      '[class*="timestamp"]'
    ];

    var textSelectors = [
      '#segment-text',
      '.segment-text',
      '[class*="segment-text"]',
      '[class*="transcript-text"]'
    ];

    var out = [];
    var seen = {};

    for (var r = 0; r < roots.length; r++) {
      for (var s = 0; s < selectors.length; s++) {
        var segments = [];

        try {
          segments = roots[r].querySelectorAll(selectors[s]);
        } catch (_) {
          continue;
        }

        for (var i = 0; i < segments.length; i++) {
          var segment = segments[i];
          var timestampText = firstMatchingText(segment, timestampSelectors);
          var transcriptText = firstMatchingText(segment, textSelectors);

          // Fallback for layouts where timestamp and transcript are combined.
          if (!timestampText || !transcriptText) {
            var combined = nodeText(segment);
            var match = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*([\s\S]*)$/.exec(combined);

            if (match) {
              if (!timestampText) timestampText = match[1];
              if (!transcriptText) transcriptText = match[2].trim();
            }
          }

          var timestamp = parseTranscriptTimestamp(timestampText);
          var text = String(transcriptText || '')
            .replace(/\s+/g, ' ')
            .trim();

          if (!timestamp || !text) continue;

          var key = timestamp + '\n' + text;
          if (seen[key]) continue;

          seen[key] = true;
          out.push({ start: timestamp, text: text });

          if (out.length >= 2000) return out;
        }
      }
    }

    return out;
  }
 
  //   ------------------------------------------------------

  function fetchTranscript(baseUrl, fetchImpl) {
    if (!baseUrl) return Promise.resolve(null);
    var f = fetchImpl || global.fetch;
    if (typeof f !== 'function') return Promise.resolve(null);
    var url = baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + 'fmt=json3';
    // Same-origin (youtube.com) request from the page's origin — no extra
    // host permission; failures fall back to chapters-only, never throw.
    return Promise.resolve()
      .then(function () { return f(url, { credentials: 'omit' }); })
      .then(function (resp) {
        if (!resp || resp.ok === false) return null;
        return resp.json();
      })
      .then(function (json) {
        var lines = parseCaptionEvents(json);
        return lines.length ? lines : null;
      })
      .catch(function () { return null; });
  }

  
  function collectYouTubeResult(doc, fetchImpl) {
    var idInfo = readVideoId(doc);
    if (!idInfo) {
      return Promise.resolve(buildYouTubeResult({}));
    }

    var chapters = parseChapterLines(readDescription(doc));
    var captionUrl = findCaptionBaseUrl(doc);

    return fetchTranscript(captionUrl, fetchImpl).then(function (lines) {
      // Prefer the caption-track extraction already supported.
      // If it fails, use timestamped lines from YouTube's open transcript panel.
      if (!lines || !lines.length) {
        lines = readTranscriptPanel(doc);
      }

      var fmt = lines && lines.length
        ? formatTranscript(lines, MAX_TRANSCRIPT_CHARS)
        : { text: '', truncated: false };

      return buildYouTubeResult({
        videoId: idInfo.videoId,
        title: readTitle(doc),
        byline: readByline(doc),
        chapters: chapters,
        transcriptText: fmt.text,
        truncated: fmt.truncated
      });
    });
  }


  function registerAdapter(win) {
    if (!win || !win.document || !win.chrome || !win.chrome.runtime ||
        !win.chrome.runtime.onMessage || win.__sahayakYouTubeAdapterRegistered) {
      return; // idempotent across repeat on-demand injections
    }
    win.__sahayakYouTubeAdapterRegistered = true;

    win.chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.family !== 'extract-article') return;
      // Async answer: return true so the router keeps the channel open.
      collectYouTubeResult(win.document, win.fetch).then(function (result) {
        try { sendResponse(result); } catch (_) { /* channel closed */ }
      });
      return true;
    });
  }

  var api = {
    MAX_TRANSCRIPT_CHARS: MAX_TRANSCRIPT_CHARS,
    msToClock: msToClock,
    parseChapterLines: parseChapterLines,
    parseCaptionEvents: parseCaptionEvents,
    formatTranscript: formatTranscript,
    buildYouTubeResult: buildYouTubeResult,
    findCaptionBaseUrl: findCaptionBaseUrl,
    readTranscriptPanel: readTranscriptPanel,
    collectYouTubeResult: collectYouTubeResult,
    registerAdapter: registerAdapter
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakYouTubeAdapter = api;
    registerAdapter(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
