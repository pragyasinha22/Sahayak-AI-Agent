/**
 * Sahayak — Article extraction + injection unit tests (Slice 1.4.1)
 * -----------------------------------------------------------------------------
 * Node-only. Covers the plan's Slice 1.4.1 Unit-tests bullets and rule 9:
 *
 *   - "adapter shape (missing title -> fallback to hostname)"
 *   - "oversized text clamped"
 *   - EC-W1-01 (parse -> null => not-an-article), EC-W1-02 (empty => no-content),
 *     EC-W1-04 (below floor => too-short), and GDR-7 (no `content`/HTML field).
 *   - "injection behavior": the read gate runs BEFORE chrome.scripting.executeScript,
 *     the correct files are injected, extract-article is forwarded through the
 *     guarded path, and a privileged page (injection rejected) sends nothing.
 *
 * The real Readability engine and Chrome APIs are NOT exercised here — the
 * adapter is fed synthetic parse() results and runExtract() is fed injected
 * fakes, so this runs deterministically under Node.
 *
 * Run with:   node tests/unit/article-extract.test.js
 * Exit code:  0 pass, 1 any failure, 2 harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

const Reader = require('../../content/article-reader.js');
const Extract = require('../../panel/features/extract.js');

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; failures.push(msg); console.log('  \u2717 ' + msg); }
}
function section(name) { console.log('\n# ' + name); }
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function makeLongBody(len) {
  // > MIN floor, plain prose-ish.
  return 'word '.repeat(Math.ceil(len / 5)).slice(0, len);
}

async function main() {
  // ==========================================================================
  // Adapter shape + size bounds + EC paths.
  // ==========================================================================
  section('buildExtractResult — adapter shape');
  {
    const MAX = Reader.MAX_ARTICLE_CHARS;
    const MIN = Reader.MIN_ARTICLE_CHARS;
    assert(typeof MAX === 'number' && MAX > 0 && typeof MIN === 'number' && MIN > 0,
      'size constants exported and positive');

    // EC-W1-01: null parse result.
    const nul = Reader.buildExtractResult(null, 'https://dashboard.example.com');
    assert(nul.ok === false && nul.error === 'not-an-article' && !!nul.message,
      'null parse -> not-an-article with a message (EC-W1-01)');

    // EC-W1-02: whitespace-only textContent.
    const empty = Reader.buildExtractResult({ title: 'x', textContent: '   \n  ' }, 'https://e.com');
    assert(empty.ok === false && empty.error === 'no-content',
      'empty textContent -> no-content (EC-W1-02)');

    // EC-W1-04: below the viable floor.
    const short = Reader.buildExtractResult({ title: 'Hi', textContent: 'too short' }, 'https://e.com');
    assert(short.ok === false && short.error === 'too-short',
      'below-floor text -> too-short (EC-W1-04)');

    // Happy path with a real title + byline.
    const body = makeLongBody(MIN + 50);
    const good = Reader.buildExtractResult(
      { title: 'My Article', byline: 'By Jane', textContent: body, content: '<p>RAW HTML</p>' },
      'https://news.example.org/post/1'
    );
    assert(good.ok === true, 'valid article -> ok:true');
    assert(good.title === 'My Article' && good.byline === 'By Jane',
      'title + byline passed through when present');
    assert(good.textContent === body.trim() && good.truncated === false,
      'in-bounds textContent returned whole, not truncated');

    // GDR-7: the sanitised-HTML `content` field must NOT be copied out.
    assert(!('content' in good) && eq(Object.keys(good).sort(), ['byline', 'ok', 'textContent', 'title', 'truncated']),
      'result exposes ONLY whitelisted fields; no HTML/content leaks (GDR-7)');
    assert(String(good.textContent).indexOf('RAW HTML') === -1,
      'raw HTML substring never present in the returned text');
  }

  section('buildExtractResult — title fallback + oversized clamp');
  {
    // Plan Unit-test bullet 1: missing title -> hostname fallback.
    const noTitle = Reader.buildExtractResult(
      { title: '', textContent: makeLongBody(Reader.MIN_ARTICLE_CHARS + 10) },
      'https://www.Example.com/some/post'
    );
    assert(noTitle.ok === true && noTitle.title === 'example.com',
      'missing title falls back to hostname (www. trimmed, lowercased)');

    // Plan Unit-test bullet 2: oversized text clamped.
    const huge = makeLongBody(Reader.MAX_ARTICLE_CHARS + 5000);
    const clamped = Reader.buildExtractResult({ title: 'Big', textContent: huge }, 'https://e.com');
    assert(clamped.ok === true && clamped.truncated === true,
      'oversized article flagged truncated');
    assert(clamped.textContent.length === Reader.MAX_ARTICLE_CHARS,
      'oversized article clamped exactly to MAX_ARTICLE_CHARS');
  }

  section('hostOf — URL parsing edge cases');
  {
    assert(Reader.hostOf('https://a.b.c/path') === 'a.b.c', 'valid URL -> hostname');
    assert(Reader.hostOf('not a url') === '', 'invalid URL -> empty string');
    assert(Reader.hostOf('') === '', 'empty URL -> empty string');
  }

  // ==========================================================================
  // runExtract — injection + safety orchestration (rule 9: injection behavior).
  // ==========================================================================
  section('runExtract — read gate runs BEFORE injection');
  {
    const order = [];
    const rendered = [];
    let injectCalls = 0;
    let sendCalls = 0;
    const panel = {
      requestActiveTabId: () => Promise.resolve(7),
      requestPageInfo: () => Promise.resolve({ url: 'https://bank.example.com/login' }),
      guardRead: () => { order.push('guardRead'); return Promise.resolve({ allowed: false, reason: 'block' }); },
      guardedSend: () => { sendCalls++; return Promise.resolve({ ok: true, result: {} }); },
    };
    const scripting = {
      executeScript: () => { order.push('executeScript'); injectCalls++; return Promise.resolve([]); },
    };

    await Extract.runExtract({ panel, scripting, render: (st) => rendered.push(st) });

    assert(injectCalls === 0, 'blocked page: chrome.scripting.executeScript NEVER called');
    assert(sendCalls === 0, 'blocked page: extract-article NEVER sent');
    assert(order.indexOf('guardRead') === 0 && order.indexOf('executeScript') === -1,
      'gate consulted first; no injection followed');
    const last = rendered[rendered.length - 1];
    assert(last && last.state === 'blocked' && /Blocked by safety/.test(last.message),
      'blocked page renders the refusal reason');
  }

  section('runExtract — allowed page injects the reader then forwards');
  {
    const order = [];
    const rendered = [];
    let injectArgs = null;
    let sendArgs = null;
    const panel = {
      requestActiveTabId: () => Promise.resolve(42),
      requestPageInfo: () => Promise.resolve({ url: 'https://news.example.org/post' }),
      guardRead: () => { order.push('guardRead'); return Promise.resolve({ allowed: true }); },
      guardedSend: (family, payload) => {
        order.push('guardedSend'); sendArgs = { family, payload };
        return Promise.resolve({ ok: true, source: 'content', result: { ok: true, title: 'Headline', byline: null, textContent: 'Body text', truncated: false } });
      },
    };
    const scripting = {
      executeScript: (inj) => { order.push('executeScript'); injectArgs = inj; return Promise.resolve([{ result: null }]); },
    };

    await Extract.runExtract({ panel, scripting, render: (st) => rendered.push(st) });

    assert(eq(order, ['guardRead', 'executeScript', 'guardedSend']),
      'strict order: gate -> inject -> guarded egress');
    assert(injectArgs && eq(injectArgs.files, Extract.DEFAULT_INJECT_FILES),
      'injects the vendored Readability.js + article-reader.js');
    assert(injectArgs && injectArgs.target.tabId === 42 && injectArgs.target.allFrames === false,
      'injects into the active tab (main frame only)');
    assert(sendArgs && sendArgs.family === 'extract-article' && sendArgs.payload.tabId === 42,
      'extract-article forwarded via the guarded path with the tabId');
    const last = rendered[rendered.length - 1];
    assert(last && last.state === 'ok' && last.title === 'Headline' && last.text === 'Body text',
      'extracted title + text rendered in the panel');
  }

  section('runExtract — privileged page (injection rejected) sends nothing');
  {
    const rendered = [];
    let sendCalls = 0;
    const panel = {
      requestActiveTabId: () => Promise.resolve(3),
      requestPageInfo: () => Promise.resolve({ url: 'chrome://extensions/' }),
      guardRead: () => Promise.resolve({ allowed: true }),
      guardedSend: () => { sendCalls++; return Promise.resolve({ ok: true, result: {} }); },
    };
    const scripting = {
      executeScript: () => Promise.reject(new Error('Cannot access a chrome:// URL')),
    };

    await Extract.runExtract({ panel, scripting, render: (st) => rendered.push(st) });

    assert(sendCalls === 0, 'EC-W1-03: rejected injection means extract-article is never sent');
    const last = rendered[rendered.length - 1];
    assert(last && last.state === 'disallowed' && last.message === Extract.MSG_DISALLOWED,
      'privileged page shows the Chrome-reserved message (EC-W1-03)');
  }

  section('runExtract — readable-but-empty result');
  {
    const rendered = [];
    const panel = {
      requestActiveTabId: () => Promise.resolve(9),
      requestPageInfo: () => Promise.resolve({ url: 'https://e.com' }),
      guardRead: () => Promise.resolve({ allowed: true }),
      guardedSend: () => Promise.resolve({ ok: true, result: { ok: false, error: 'not-an-article', message: 'not an article msg' } }),
    };
    const scripting = { executeScript: () => Promise.resolve([]) };

    await Extract.runExtract({ panel, scripting, render: (st) => rendered.push(st) });
    const last = rendered[rendered.length - 1];
    assert(last && last.state === 'empty' && last.message === 'not an article msg',
      'adapter "not an article" surfaces as an empty state, not a crash');
  }

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

main().catch((err) => { console.error('Harness error:', err); process.exit(2); });
