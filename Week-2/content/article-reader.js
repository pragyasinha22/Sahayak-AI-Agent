/**
 * Sahayak — Article extractor content script (Slice 1.4.1)
 * -----------------------------------------------------------------------------
 * PS §2.3 / Arch §3.3 "Article Reader — runs Mozilla Readability.js over a
 * cloned document to extract title + main content, stripping nav/ads/sidebars/
 * footers". This is the FIRST real page-read slice.
 *
 * It is loaded ON DEMAND into the active tab via chrome.scripting alongside the
 * genuinely-vendored `vendor/Readability.js` (Apache-2.0, mozilla/readability
 * commit ab4027a8b37669745016869a37a504727992b2ba — master AFTER the 0.6.0 tag;
 * byte-verified against upstream, see vendor/NOTICE), NOT as a permanent
 * declarative content script — see panel/features/extract.js. Because it is only
 * ever injected after the panel's read gate has allowed the page, no content is
 * read from a blocked/unknown page.
 *
 * Architectural rules honoured:
 *   - GDR-7 / INV-5  The reply carries ONLY { title, byline, textContent }. The
 *                    Readability `content` field (sanitised HTML) is DISCARDED —
 *                    raw HTML never leaves the page.
 *   - GDR-3 / INV-2  No API key ever reaches a content script. This file never
 *                    reads chrome.storage and never sees a key.
 *   - EC-SEC-05      Runs in the isolated world; page scripts can't see it.
 *
 * Edge cases folded into the pure adapter (docs/edge-case.md):
 *   - EC-W1-01  Readability.parse() -> null (dashboard/SPA/index) => not-an-article.
 *   - EC-W1-02  empty / whitespace-only textContent                => no-content.
 *   - EC-W1-04  text below the viable floor                        => too-short.
 *   - Oversized selections/text clamped (INV-5 compactness).
 *   - Missing title falls back to the hostname (plan Unit-test bullet 1).
 *
 * Node-testable: `buildExtractResult`, `hostOf` and the size constants are
 * exported under CommonJS so tests/unit/article-extract.test.js can exercise the
 * adapter shape without a browser or the real Readability engine.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // Size bounds. MAX keeps the model input compact (INV-5); MIN is the EC-W1-04
  // floor below which a "summary would be meaningless", so extraction reports it
  // rather than emitting a stub.
  var MAX_ARTICLE_CHARS = 40000;
  var MIN_ARTICLE_CHARS = 200;

  // Stable, understandable messages (never contain page HTML or keys — INV-9).
  var NOT_AN_ARTICLE_MESSAGE =
    'This page doesn\u2019t look like a readable article, so Sahayak can\u2019t ' +
    'extract it. Try a news or blog page.';
  var NO_CONTENT_MESSAGE =
    'Sahayak couldn\u2019t find any readable content on this page.';
  var TOO_SHORT_MESSAGE =
    'This article is too short to extract usefully. Sahayak needs a few ' +
    'paragraphs first.';

  /** Best-effort hostname (leading `www.` trimmed); '' when the URL is invalid. */
  function hostOf(url) {
    try {
      var u = new URL(url);
      var h = u.hostname || '';
      return h.replace(/^www\./i, '') || h;
    } catch (_) {
      return '';
    }
  }

  /**
   * Pure adapter: turns a Readability.parse() result (or null) into the only
   * shape allowed to leave the page. Never copies `content` (HTML) through.
   */
  function buildExtractResult(parsed, sourceUrl) {
    if (parsed == null || typeof parsed !== 'object') {
      // EC-W1-01: not an article.
      return { ok: false, error: 'not-an-article', message: NOT_AN_ARTICLE_MESSAGE };
    }
    var raw = (typeof parsed.textContent === 'string') ? parsed.textContent : '';
    var text = raw.trim();
    if (text.length === 0) {
      // EC-W1-02: nothing readable.
      return { ok: false, error: 'no-content', message: NO_CONTENT_MESSAGE };
    }
    if (text.length < MIN_ARTICLE_CHARS) {
      // EC-W1-04: below the viable floor.
      return { ok: false, error: 'too-short', message: TOO_SHORT_MESSAGE };
    }
    var title = (typeof parsed.title === 'string' && parsed.title.trim())
      ? parsed.title.trim()
      : (hostOf(sourceUrl) || null); // plan Unit-test: title -> hostname fallback
    var byline = (parsed.byline && String(parsed.byline).trim())
      ? String(parsed.byline).trim()
      : null;
    var truncated = text.length > MAX_ARTICLE_CHARS;
    var out = truncated ? text.slice(0, MAX_ARTICLE_CHARS) : text;
    return {
      ok: true,
      title: title,
      byline: byline,
      textContent: out,
      truncated: truncated
      // Deliberately NO `content` field — GDR-7 forbids HTML egress.
    };
  }

  // --------------------------------------------------------------------------
  // Isolated-world wiring (browser only). Guarded so requiring the adapter in
  // Node for unit tests has no side effects and touches no Chrome API.
  // --------------------------------------------------------------------------
  function registerExtractListener(win) {
    if (!win || !win.chrome || !win.chrome.runtime ||
        !win.chrome.runtime.onMessage) {
      return;
    }
    if (win.__sahayakArticleReaderRegistered) return; // idempotent across re-injects
    win.__sahayakArticleReaderRegistered = true;

    win.chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      // Only claim the extract-article family; stay silent for everything else
      // so this reader never clobbers other families (or the 1.1.4 stub).
      if (!message || message.family !== 'extract-article') return false;

      var result;
      try {
        if (typeof win.Readability !== 'function') {
          result = { ok: false, error: 'readability-missing', message: NOT_AN_ARTICLE_MESSAGE };
        } else {
          // Readability mutates the document it parses, so hand it a CLONE and
          // leave the live page untouched (Arch §3.3 "content clone document").
          var clone = win.document.cloneNode(true);
          var parsed = new win.Readability(clone, {}).parse();
          result = buildExtractResult(parsed, win.location.href);
        }
      } catch (_) {
        // Any engine fault degrades to the "not an article" surface, never a
        // crash and never raw-HTML leakage.
        result = { ok: false, error: 'readability-failed', message: NOT_AN_ARTICLE_MESSAGE };
      }
      try { sendResponse(result); } catch (_) { /* channel already closed */ }
      return false; // synchronous reply
    });
  }

  var api = {
    MAX_ARTICLE_CHARS: MAX_ARTICLE_CHARS,
    MIN_ARTICLE_CHARS: MIN_ARTICLE_CHARS,
    NOT_AN_ARTICLE_MESSAGE: NOT_AN_ARTICLE_MESSAGE,
    NO_CONTENT_MESSAGE: NO_CONTENT_MESSAGE,
    TOO_SHORT_MESSAGE: TOO_SHORT_MESSAGE,
    hostOf: hostOf,
    buildExtractResult: buildExtractResult
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakArticleReader = api;
    registerExtractListener(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
