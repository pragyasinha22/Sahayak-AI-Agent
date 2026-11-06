/**
 * Sahayak — Article Summarise unit tests (Slice 1.5.1)
 * -----------------------------------------------------------------------------
 * Node-only. Exercises the plan's Slice 1.5.1 Unit-tests bullets verbatim:
 *
 *   1. "parser against expected 3-section structure" -> parseSummarySections
 *   2. "'page doesn't say' path when content is missing" -> the short/failed
 *      extraction refusal in runSummarise (MSG_NOT_SUMMARISABLE)
 *
 * plus the acceptance-critical invariants:
 *   - exactly 1 TL;DR line + exactly 5 key points + next actions reach render
 *     (extra points trimmed, under-5 treated as malformed, never rendered);
 *   - the read gate runs BEFORE any injection or egress (Arch §6.1) and a
 *     blocked page injects/sends nothing at all;
 *   - GDR-3 / INV-2: the API key never appears in the prompt;
 *   - GDR-7 / INV-5: the prompt carries plain text only, never page HTML;
 *   - Slice 1.7.1 token plumbing: the panel language feeds the prompt.
 *
 * No Chrome, no network: every collaborator (panel, scripting, getKey, callAI)
 * is a fake. Run with:   node tests/unit/summarise.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

// summarise.js resolves its prompt module + provider lazily off the global,
// exactly like the browser does off <script> order. Wire the same here.
global.SahayakArticleSummary = require('../../panel/prompts/article-summary.js');
global.SahayakPreferences = require('../../state/preferences.js');

const Summarise = require('../../panel/features/summarise.js');
const SummaryPrompt = global.SahayakArticleSummary;

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + msg);
  } else {
    fail++;
    failures.push(msg);
    console.log('  \u2717 ' + msg);
  }
}

function section(name) {
  console.log('\n# ' + name);
}

const LONG_TEXT = 'Machine learning quietly changes how phones work. '.repeat(12);

function makeArticle(over) {
  return Object.assign({
    ok: true,
    title: 'How phones learn',
    byline: 'Ada',
    textContent: LONG_TEXT,
    truncated: false
  }, over || {});
}

/** Fake SahayakPanel + chrome.scripting with call recording/ordering. */
function makeDeps(opts) {
  const o = opts || {};
  const calls = [];
  const panel = {
    requestActiveTabId: () => Promise.resolve(7),
    requestPageInfo: () => Promise.resolve({ tabId: 7, url: o.url || 'https://example.com/article' }),
    guardRead: () => {
      calls.push('guardRead');
      return Promise.resolve(o.dec || { allowed: true, decision: 'allow' });
    },
    guardedSend: (family, payload) => {
      calls.push('guardedSend');
      return Promise.resolve(o.sendResult || { ok: true, source: 'content', result: makeArticle(o.article) });
    }
  };
  const scripting = {
    executeScript: (req) => {
      calls.push('executeScript');
      if (o.injectThrows) return Promise.reject(new Error('Cannot access reserved page'));
      return Promise.resolve([]);
    }
  };
  return { panel, scripting, calls };
}

const VALID_REPLY = [
  '## TL;DR',
  'Phones are learning to work smarter on-device.',
  '',
  '## Key points',
  '- On-device models cut latency.',
  '- Photos improve without cloud uploads.',
  '- Battery-aware scheduling matters.',
  '- Keyboard prediction adapts per user.',
  '- Privacy stays local by design.',
  '- (extra sixth point must be trimmed)',
  '',
  '## What to do next',
  '- Check which apps run on-device AI.',
  '- Review photo settings for local processing.'
].join('\n');

async function main() {
  // ==========================================================================
  // 1. Prompt template — plain text only, article content present (GDR-7).
  // ==========================================================================
  section('buildSummaryPrompt — plain-text-only');
  {
    const p = SummaryPrompt.buildSummaryPrompt({ title: 'T', textContent: LONG_TEXT });
    assert(p.indexOf(LONG_TEXT) !== -1, 'article text appears in the prompt');
    assert(p.indexOf('<div') === -1 && p.indexOf('<html') === -1,
      'prompt template contains no page HTML');
    assert(p.indexOf('TL;DR') !== -1 && p.indexOf('Key points') !== -1 &&
      p.indexOf('What to do next') !== -1, 'template demands all three sections');
    assert(SummaryPrompt.buildSummaryPrompt(null).length > 0,
      'null article still yields a prompt without throwing');
  }

  // ==========================================================================
  // 2. Parser against the expected 3-section structure (plan bullet 1).
  // ==========================================================================
  section('parseSummarySections — 3-section structure');
  {
    const r = SummaryPrompt.parseSummarySections(VALID_REPLY);
    assert(r.ok === true, 'well-formed reply parses ok');
    assert(r.tldr === 'Phones are learning to work smarter on-device.',
      'exactly 1 TL;DR line extracted');
    assert(Array.isArray(r.points) && r.points.length === 5,
      'exactly 5 key points (6th bullet trimmed)');
    assert(Array.isArray(r.nextActions) && r.nextActions.length === 2,
      'next-action list captured');

    const short = SummaryPrompt.parseSummarySections(
      '## TL;DR\nx\n\n## Key points\n- a\n- b\n\n## What to do next\n- c');
    assert(short.ok === false && short.error === 'malformed',
      'fewer than 5 points is malformed, never rendered partially');

    const missing = SummaryPrompt.parseSummarySections('Just prose, no sections.');
    assert(missing.ok === false && missing.error === 'malformed',
      'missing sections -> malformed with stable retry message');
    assert(missing.message === SummaryPrompt.MSG_MALFORMED,
      'malformed carries an understandable user message');

    const empty = SummaryPrompt.parseSummarySections('');
    assert(empty.ok === false && empty.error === 'empty',
      'empty reply -> graceful empty error');

    const numbered = SummaryPrompt.parseSummarySections(
      '### TL;DR: on-device AI\nPhones learn locally.\n' +
      'Key points\n1. a\n2. b\n3. c\n4. d\n5. e\n' +
      'Next actions\n* try it');
    assert(numbered.ok === true && numbered.points.length === 5 &&
      numbered.nextActions.length === 1,
      'heading/bullet style variance (#, bold-less, numbered, *) still parses');
  }

  // ==========================================================================
  // 3. Orchestration — gate before any read/inject (Arch §6.1).
  // ==========================================================================
  section('runSummarise — safety order');
  {
    const rendered = [];
    const d = makeDeps({ dec: { allowed: false, decision: 'block', reason: 'sensitive-host' } });
    await Summarise.runSummarise({
      panel: d.panel, scripting: d.scripting,
      render: (st) => rendered.push(st),
      getKey: () => { throw new Error('getKey must not run on a blocked page'); },
      callAI: () => { throw new Error('callAI must not run on a blocked page'); }
    });
    assert(d.calls.indexOf('executeScript') === -1 && d.calls.indexOf('guardedSend') === -1,
      'blocked page: NOTHING injected or sent');
    assert(rendered[rendered.length - 1].state === 'blocked',
      'blocked page renders the safety refusal');

    const d2 = makeDeps();
    await Summarise.runSummarise({
      panel: d2.panel, scripting: d2.scripting, render: () => {},
      getKey: () => Promise.resolve('k'), callAI: () => Promise.resolve({ ok: true, text: VALID_REPLY })
    });
    assert(d2.calls.join(',') === 'guardRead,executeScript,guardedSend',
      'order is gate -> inject -> sanctioned egress');
  }

  // ==========================================================================
  // 4. "Page doesn't say" path (plan bullet 2) + error branches.
  // ==========================================================================
  section('runSummarise — graceful refusals');
  {
    const seen = {};
    const run = async (deps) => {
      const out = [];
      await Summarise.runSummarise(Object.assign({ render: (st) => out.push(st) }, deps));
      return out[out.length - 1];
    };

    const d = makeDeps({ article: { textContent: 'tiny' } });
    seen.short = await run({ panel: d.panel, scripting: d.scripting, getKey: () => Promise.resolve('k'), callAI: () => Promise.resolve({ ok: true, text: VALID_REPLY }) });
    assert(seen.short.state === 'empty' && seen.short.message === Summarise.MSG_NOT_SUMMARISABLE,
      'too-little-text page -> "page doesn\u2019t say" refusal, no AI call');

    const dFail = makeDeps({ sendResult: { ok: true, result: { ok: false, error: 'not-an-article' } } });
    seen.fail = await run({ panel: dFail.panel, scripting: dFail.scripting, getKey: () => Promise.resolve('k'), callAI: () => { throw new Error('callAI must not run when extraction failed'); } });
    assert(seen.fail.state === 'empty', 'failed extraction renders gracefully');

    seen.noKey = await run(Object.assign(makeDeps(), { getKey: () => Promise.resolve(null), callAI: () => { throw new Error('callAI must not run without a key'); } }));
    assert(seen.noKey.state === 'missing-key', 'missing key -> stable settings hint (EC-W1-07)');

    const dAuth = makeDeps();
    seen.auth = await run({ panel: dAuth.panel, scripting: dAuth.scripting, getKey: () => Promise.resolve('k'), callAI: () => Promise.resolve({ ok: false, error: 'auth', message: 'Gemini rejected your API key.' }) });
    assert(seen.auth.state === 'error' && seen.auth.message.indexOf('API key') !== -1,
      'provider auth error surfaces its message');

    const dBad = makeDeps();
    seen.malformed = await run({ panel: dBad.panel, scripting: dBad.scripting, getKey: () => Promise.resolve('k'), callAI: () => Promise.resolve({ ok: true, text: 'prose without sections' }) });
    assert(seen.malformed.state === 'error' && seen.malformed.error === 'malformed',
      'malformed AI reply is refused, never half-rendered');

    seen.noDeps = await run({});
    assert(seen.noDeps.state === 'unavailable', 'missing collaborators -> unavailable, no throw');

    const dInject = makeDeps({ injectThrows: true });
    seen.disallowed = await run({ panel: dInject.panel, scripting: dInject.scripting, getKey: () => Promise.resolve('k'), callAI: () => Promise.resolve({ ok: true, text: VALID_REPLY }) });
    assert(seen.disallowed.state === 'disallowed',
      'reserved-page injection rejection maps to the disallowed message (EC-W1-03)');
  }

  // ==========================================================================
  // 5. Happy path render + key confinement + language token (1.7.1).
  // ==========================================================================
  section('runSummarise — structured render + invariants');
  {
    const out = [];
    let capturedPrompt = '';
    const d = makeDeps();
    await Summarise.runSummarise({
      panel: d.panel, scripting: d.scripting,
      render: (st) => out.push(st),
      getKey: () => Promise.resolve('SECRET-KEY-123'),
      callAI: (opts) => {
        capturedPrompt = opts.prompt;
        return Promise.resolve({ ok: true, text: VALID_REPLY });
      }
    });
    const done = out[out.length - 1];
    assert(done.state === 'ok', 'happy path renders ok');
    assert(typeof done.tldr === 'string' && done.points.length === 5 &&
      done.nextActions.length >= 1,
      'render receives exactly TL;DR + 5 points + next actions');
    assert(capturedPrompt.indexOf('SECRET-KEY-123') === -1,
      'API key never appears in the prompt (GDR-3 / INV-2)');
    assert(capturedPrompt.indexOf(LONG_TEXT) !== -1,
      'the extracted plain text is what the model summarises');

    // Slice 1.7.1: with the panel language cached as hinglish, the prompt must
    // carry the Hinglish instruction token.
    global.SahayakLanguage = { current: () => 'hinglish' };
    const outH = [];
    const dH = makeDeps();
    await Summarise.runSummarise({
      panel: dH.panel, scripting: dH.scripting,
      render: (st) => outH.push(st),
      getKey: () => Promise.resolve('k'),
      callAI: (opts) => { capturedPrompt = opts.prompt; return Promise.resolve({ ok: true, text: VALID_REPLY }); }
    });
    assert(capturedPrompt.indexOf('Hinglish') !== -1,
      'hinglish preference injects the language token into the summary prompt');
    assert(outH[outH.length - 1].state === 'ok', 'language path renders ok too');
    delete global.SahayakLanguage;

    const dEn = makeDeps();
    await Summarise.runSummarise({
      panel: dEn.panel, scripting: dEn.scripting, render: () => {},
      getKey: () => Promise.resolve('k'),
      callAI: (opts) => { capturedPrompt = opts.prompt; return Promise.resolve({ ok: true, text: VALID_REPLY }); }
    });
    assert(capturedPrompt.indexOf('Reply in clear, simple English.') !== -1,
      'no language cached -> safe English default');
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n----------------------------------------');
  console.log('Summary: ' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Harness error:', err);
  process.exit(2);
});
