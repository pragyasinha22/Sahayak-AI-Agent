/**
 * Sahayak — Article-summary prompt + section parser (Slice 1.5.1)
 * -----------------------------------------------------------------------------
 * PS §2.4 / Plan Slice 1.5.1: "send extracted text + summary template to the
 * provider, parse the returned markdown into three sections, render TL;DR,
 * five key points and next actions".
 *
 * This module is PURE (no chrome.*, no DOM, no fetch) so it is fully
 * Node-testable in tests/unit/summarise.test.js, mirroring the Slice 1.3.1
 * split in panel/features/explain.js (pure builders on top, wiring below).
 *
 * Privacy invariants honoured here:
 *   - GDR-7 / INV-5  buildSummaryPrompt embeds ONLY the adapter's extracted
 *                    plain text (never raw HTML) and instructs the model to
 *                    use only the provided text (the "page doesn't say"
 *                    behaviour of PS §2.4: missing information is omitted,
 *                    never invented).
 *   - The acceptance rule "summary always contains exactly 1 TL;DR line, 5
 *     key points, and a next-action list" is ENFORCED by
 *     parseSummarySections(): more than 5 points are trimmed, fewer than 5
 *     (or a missing section) is reported as malformed instead of rendered
 *     as a partial summary.
 *
 * Sources:
 *   - docs/problemStatement.md §2.4
 *   - docs/implementation-plan.md Slice 1.5.1 (Unit tests bullets)
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var REQUIRED_POINTS = 5;

  // Stable user-facing copy. Never contains payload data (INV-9).
  var MSG_MALFORMED =
    'Gemini returned an incomplete summary. Please press Summarise again.';
  var MSG_EMPTY_RESPONSE =
    'Gemini returned no summary text. Please try again.';

  /**
   * Builds the structured-summary prompt from the Readability adapter's
   * plain-text result ONLY. `article` is { title?, textContent? }.
   * The template demands exactly three markdown sections so the parser below
   * can enforce the "1 TL;DR + 5 points + next actions" acceptance criterion.
   *
   * Slice 1.7.1: optional `language` injects the response-language token
   * (single source: state/preferences.js). Omitted -> English, which keeps
   * every pre-1.7.1 call and test unchanged.
   */
  function buildSummaryPrompt(article, language) {
    var a = article || {};
    var text = (typeof a.textContent === 'string') ? a.textContent : '';
    var title = (typeof a.title === 'string') ? a.title : '(untitled)';
    return (
      'You are Sahayak, a careful reading assistant. Summarise the article ' +
      'below using ONLY the text provided. If the article does not say ' +
      'something, leave it out \u2014 never invent facts.\n' +
      languageLine(language) + '\n\n' +
      'Respond in EXACTLY this structure (three markdown sections, no other ' +
      'headings, no preamble):\n' +
      '## TL;DR\n<one single sentence>\n' +
      '## Key points\n- point 1\n- point 2\n- point 3\n- point 4\n- point 5\n' +
      '(exactly five bullets)\n' +
      '## What to do next\n- action 1\n- action 2\n- action 3\n\n' +
      'ARTICLE TITLE: ' + title + '\n' +
      'ARTICLE TEXT:\n"""\n' + text + '\n"""'
    );
  }

  function languageLine(language) {
    var prefs = global.SahayakPreferences;
    if (prefs && typeof prefs.languageInstruction === 'function') {
      return prefs.languageInstruction(language);
    }
    return 'Reply in clear, simple English.';
  }

  // --------------------------------------------------------------------------
  // Parser. Line walker that finds the three required sections regardless of
  // heading style variance (#/##/###, trailing colon, bold **TL;DR**) and
  // bullet style variance (-, *, \u2022, "1." / "1)").
  // --------------------------------------------------------------------------
  var TLDR_HEADING = /^#{0,3}\s*\**\s*t\.?l\.?;?\s*dr\b[^*\n]*\**\s*:?\s*$/i;
  var POINTS_HEADING = /^#{0,3}\s*\**\s*key\s*points\b[^*\n]*\**\s*:?\s*$/i;
  var NEXT_HEADING = /^#{0,3}\s*\**\s*(what\s+to\s+do\s+next|next\s+actions?)\b[^*\n]*\**\s*:?\s*$/i;
  var BULLET = /^\s*(?:[-*\u2022]|\d+[.)])\s+(.*\S)\s*$/;

  function sectionWalker(lines) {
    var sections = { tldr: [], points: [], next: [] };
    var current = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (TLDR_HEADING.test(line)) { current = 'tldr'; continue; }
      if (POINTS_HEADING.test(line)) { current = 'points'; continue; }
      if (NEXT_HEADING.test(line)) { current = 'next'; continue; }
      if (/^#{1,3}\s/.test(line)) { current = null; continue; } // unknown heading
      if (!current) continue;
      if (current === 'tldr') {
        if (line.trim() !== '') sections.tldr.push(line.trim());
      } else {
        var m = BULLET.exec(line);
        if (m) sections[current === 'points' ? 'points' : 'next'].push(m[1]);
      }
    }
    return sections;
  }

  /**
   * parseSummarySections(raw) -> Promise-free object:
   *   { ok: true,  tldr, points (exactly 5), nextActions }  — renderable
   *   { ok: false, error: 'empty' | 'malformed', message }  — graceful retry
   * Extra points are trimmed to the first 5; fewer than 5 points, a missing
   * section, or no next actions is malformed (acceptance is all-or-nothing).
   */
  function parseSummarySections(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { ok: false, error: 'empty', message: MSG_EMPTY_RESPONSE };
    }
    var lines = raw.split(/\r?\n/);
    var s = sectionWalker(lines);

    if (s.tldr.length === 0 || s.points.length === 0 || s.next.length === 0) {
      return { ok: false, error: 'malformed', message: MSG_MALFORMED };
    }
    if (s.points.length < REQUIRED_POINTS) {
      return { ok: false, error: 'malformed', message: MSG_MALFORMED };
    }

    return {
      ok: true,
      tldr: s.tldr[0],                       // exactly 1 TL;DR line
      points: s.points.slice(0, REQUIRED_POINTS), // exactly 5 key points
      nextActions: s.next                    // next-action list
    };
  }

  var api = {
    REQUIRED_POINTS: REQUIRED_POINTS,
    MSG_MALFORMED: MSG_MALFORMED,
    MSG_EMPTY_RESPONSE: MSG_EMPTY_RESPONSE,
    buildSummaryPrompt: buildSummaryPrompt,
    parseSummarySections: parseSummarySections
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakArticleSummary = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
