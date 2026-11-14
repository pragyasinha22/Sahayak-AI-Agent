/**
 * Sahayak — YouTube summarisation unit tests (Slice 1.6.1)
 * -----------------------------------------------------------------------------
 * Node-only. Exercises the plan's Slice 1.6.1 Unit-tests bullets verbatim:
 *
 *   1. "URL parser (watch, youtu.be, shorts) and video-id validation"
 *                                                -> shared/youtube-url.js
 *   2. "empty-transcript fallback shows refusal message"
 *                                                -> buildYouTubeResult +
 *                                                   runYouTubeSummarise
 *
 * plus adapter helpers (chapter lines, json3 caption events, clock format,
 * transcript clamp, whitelisted result shape — GDR-7: no HTML ever), the
 * gate-before-injection order (Arch §6.1), non-YouTube URL refusal, and the
 * Slice 1.7.1 language token. A fake `document` stands in for the page DOM;
 * no Chrome APIs and no network are touched (fetch is injected).
 *
 * Run with:   node tests/unit/youtube.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

global.SahayakYouTubeUrl = require('../../shared/youtube-url.js');
global.SahayakPreferences = require('../../state/preferences.js');

const YouTubeUrl = global.SahayakYouTubeUrl;
const Adapter = require('../../content/youtube-adapter.js');
const YouTube = require('../../panel/features/youtube.js');

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

const VID = 'dQw4w9WgXcQ'; // 11-char public-format id (classic example)

function makeDeps(opts) {
  const o = opts || {};
  const calls = [];
  const panel = {
    requestActiveTabId: () => Promise.resolve(9),
    requestPageInfo: () => Promise.resolve({
      tabId: 9,
      url: o.url || 'https://www.youtube.com/watch?v=' + VID
    }),
    guardRead: () => {
      calls.push('guardRead');
      return Promise.resolve(o.dec || { allowed: true, decision: 'allow' });
    },
    guardedSend: () => {
      calls.push('guardedSend');
      return Promise.resolve(o.sendResult || {
        ok: true,
        source: 'content',
        result: o.videoResult || {
          ok: true, kind: 'youtube', videoId: VID,
          title: 'A talk', byline: 'Channel',
          hasTranscript: true,
          chapters: [{ time: '0:00', label: 'Intro' }],
          textContent: '[0:00] hello world\n[1:05] deep work',
          truncated: false
        }
      });
    }
  };
  const scripting = {
    executeScript: () => {
      calls.push('executeScript');
      return Promise.resolve([]);
    }
  };
  return { panel, scripting, calls };
}

async function main() {
  // ==========================================================================
  // 1. URL parser — watch, youtu.be, shorts + id validation (plan bullet 1).
  // ==========================================================================
  section('parseYouTubeUrl');
  {
    const w = YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/watch?v=' + VID + '&t=42');
    assert(w.ok === true && w.videoId === VID && w.kind === 'watch',
      'watch URL parses with query noise');
    assert(w.canonicalUrl === 'https://www.youtube.com/watch?v=' + VID,
      'canonical URL is rebuilt');

    const be = YouTubeUrl.parseYouTubeUrl('https://youtu.be/' + VID);
    assert(be.ok === true && be.videoId === VID && be.kind === 'be', 'youtu.be short link parses');

    const sh = YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/shorts/' + VID);
    assert(sh.ok === true && sh.kind === 'shorts', 'shorts URL parses');

    const live = YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/live/' + VID);
    assert(live.ok === true, 'live URL parses');

    assert(YouTubeUrl.parseYouTubeUrl('https://vimeo.com/123').reason === 'not-youtube',
      'non-YouTube host is rejected');
    assert(YouTubeUrl.parseYouTubeUrl('https://example.com/watch?v=' + VID).reason === 'not-youtube',
      'lookalike params on other hosts are rejected');
    assert(YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/watch').reason === 'no-video-id',
      'watch without v= is rejected');
    assert(YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/watch?v=short').reason === 'bad-video-id',
      'video id shorter than 11 chars is rejected');
    assert(YouTubeUrl.parseYouTubeUrl('https://www.youtube.com/watch?v=' + VID + 'x').reason === 'bad-video-id',
      'video id longer than 11 chars is rejected');
    assert(YouTubeUrl.parseYouTubeUrl('').reason === 'empty' &&
      YouTubeUrl.parseYouTubeUrl('not a url').reason === 'not-url',
      'empty/garbage inputs reject without throwing');
    assert(YouTubeUrl.isYouTubeUrl('https://m.youtube.com/watch?v=' + VID) === true,
      'mobile subdomain accepted');
  }

  // ==========================================================================
  // 2. Adapter pure helpers.
  // ==========================================================================
  section('adapter helpers');
  {
    assert(Adapter.msToClock(0) === '0:00' && Adapter.msToClock(65000) === '1:05' &&
      Adapter.msToClock(3725000) === '1:02:05',
      'ms -> clock formatting (mm:ss and h:mm:ss)');

    const ch = Adapter.parseChapterLines(
      'Chapters:\n0:00 intro\n1:02 - the problem\n1:02:03 deep work\n' +
      'This video was filmed in Bengaluru.\n20:15 : wrap up\n12:99 not a time');
    assert(ch.length === 4 && ch[0].time === '0:00' && ch[1].label === 'the problem' &&
      ch[2].time === '1:02:03',
      'description chapter lines parsed, prose ignored');
    assert(Adapter.parseChapterLines('').length === 0 &&
      Adapter.parseChapterLines(null).length === 0,
      'empty description -> no chapters, no throw');

    const ev = Adapter.parseCaptionEvents({
      events: [
        { tStartMs: 0, segs: [{ utf8: 'hello &amp; welcome' }] },
        { tStartMs: 1200, segs: [{ utf8: '[Music]' }] },
        { tStartMs: 65000, segs: [{ utf8: 'next' }, { utf8: ' bit' }] },
        { tStartMs: 70000 }
      ]
    });
    assert(ev.length === 2 && ev[0].text === 'hello & welcome' &&
      ev[0].start === '0:00' && ev[1].text === 'next bit' && ev[1].start === '1:05',
      'json3 caption events parsed defensively ([Music] and seg-less skipped)');
    assert(Adapter.parseCaptionEvents(null).length === 0 &&
      Adapter.parseCaptionEvents({}).length === 0,
      'malformed caption json -> empty list');

    const fmt = Adapter.formatTranscript(
      [{ start: '0:00', text: 'aaaaaaaaaa' }, { start: '0:05', text: 'bbbbbbbbbb' }], 25);
    assert(fmt.truncated === true && fmt.text.indexOf('bbbbbbbbbb') === -1,
      'oversized transcript clamped with truncated flag (EC oversized input)');

    const r = Adapter.buildYouTubeResult({ videoId: VID, title: 'T', transcriptText: '[0:00] hi' });
    assert(r.ok === true && r.kind === 'youtube', 'transcript present -> whitelisted ok result');
    const keys = Object.keys(r).sort().join(',');
    assert(keys === 'byline,chapters,hasTranscript,kind,ok,textContent,title,truncated,videoId',
      'result is a fixed whitelist — no HTML or page data can ride along (GDR-7)');

    const none = Adapter.buildYouTubeResult({ videoId: VID, title: 'T', transcriptText: '', chapters: [] });
    assert(none.ok === false && none.error === 'no-transcript',
      'empty-transcript fallback -> no-transcript refusal (plan bullet 2)');

    const chaptersOnly = Adapter.buildYouTubeResult({
      videoId: VID, title: 'T', chapters: [{ time: '0:00', label: 'Intro' }, { time: '4:10', label: 'Demo' }]
    });
    assert(chaptersOnly.ok === true && chaptersOnly.hasTranscript === false &&
      chaptersOnly.textContent.indexOf('[4:10] Demo') !== -1,
      'chapters-only videos summarise from timestamps');
  }

  // ==========================================================================
  // 3A. YouTube transcript panel extraction.
  // ==========================================================================
  section('YouTube transcript panel extraction');
  {
    const segments = [
      { timestamp: '0:01', text: '[Music]' },
      { timestamp: '0:08', text: '[Applause]' },
      { timestamp: '0:12', text: 'Hey son, yes Mom, where are you going so early in the morning?' }
    ];

    const fakeDoc = {
      querySelectorAll: (selector) => {
        if (selector === '*') return [];

        if (selector === 'ytd-transcript-segment-renderer') {
          return segments.map((item) => ({
            querySelectorAll: (childSelector) => {
              if (childSelector === '#segment-timestamp') {
                return [{ textContent: item.timestamp }];
              }

              if (childSelector === '#segment-text') {
                return [{ textContent: item.text }];
              }

              return [];
            }
          }));
        }

        return [];
      }
    };

    const lines = Adapter.readTranscriptPanel(fakeDoc);

    assert(
      Array.isArray(lines) && lines.length === 3,
      'visible transcript panel segments are extracted'
    );

    assert(
      lines[0].text === '[Music]' &&
      lines[2].text.indexOf('Hey son') !== -1,
      'English transcript text is preserved'
    );

    assert(
      lines[0].start === '0:01' && lines[2].start === '0:12',
      'transcript timestamps are preserved'
    );
  }
  
  // ==========================================================================
  // 4. Panel orchestration — gate order, refusals, key confinement.
  // ==========================================================================
  section('runYouTubeSummarise');
  {
    let promptSeen = '';
    const d = makeDeps();
    const out = [];
    await YouTube.runYouTubeSummarise({
      panel: d.panel, scripting: d.scripting,
      parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => out.push(st),
      getKey: () => Promise.resolve('SECRET-KEY-123'),
      callAI: (opts) => { promptSeen = opts.prompt; return Promise.resolve({ ok: true, text: '- [0:00] Intro\nOverall: good' }); }
    });
    assert(d.calls.join(',') === 'guardRead,executeScript,guardedSend',
      'order is gate -> inject -> sanctioned egress');
    const done = out[out.length - 1];
    assert(done.state === 'ok' && done.notes.indexOf('[0:00]') !== -1,
      'happy path renders timestamped chapter notes');
    assert(promptSeen.indexOf('hello world') !== -1,
      'transcript text feeds the prompt');
    assert(promptSeen.indexOf('<div') === -1 && promptSeen.indexOf('SECRET-KEY-123') === -1,
      'prompt carries no HTML and never the API key (GDR-7 / GDR-3)');

    const dB = makeDeps({ dec: { allowed: false, reason: 'sensitive-host' } });
    const outB = [];
    await YouTube.runYouTubeSummarise({
      panel: dB.panel, scripting: dB.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => outB.push(st), getKey: () => { throw new Error('must not run'); },
      callAI: () => { throw new Error('must not run'); }
    });
    assert(dB.calls.indexOf('executeScript') === -1 && outB[outB.length - 1].state === 'blocked',
      'blocked page: nothing injected, nothing sent');

    const dN = makeDeps({ url: 'https://example.com/article' });
    const outN = [];
    await YouTube.runYouTubeSummarise({
      panel: dN.panel, scripting: dN.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => outN.push(st), getKey: () => Promise.resolve('k'),
      callAI: () => { throw new Error('callAI must not run for non-YouTube URLs'); }
    });
    assert(outN[outN.length - 1].state === 'not-a-video' && dN.calls.indexOf('executeScript') === -1,
      'non-YouTube tab refuses BEFORE injecting anything');

    const dNT = makeDeps({ videoResult: { ok: false, error: 'no-transcript' } });
    const outNT = [];
    await YouTube.runYouTubeSummarise({
      panel: dNT.panel, scripting: dNT.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => outNT.push(st), getKey: () => Promise.resolve('k'),
      callAI: () => { throw new Error('unavailable transcript must not hit the model'); }
    });
    assert(outNT[outNT.length - 1].state === 'cannot' &&
      outNT[outNT.length - 1].message === YouTube.MSG_CANNOT_SUMMARISE,
      'transcript-unavailable -> clear "cannot be summarised" message (PS §2.5)');

    const dStale = makeDeps({ videoResult: { ok: false, error: 'not-an-article' } });
    const outStale = [];
    await YouTube.runYouTubeSummarise({
      panel: dStale.panel, scripting: dStale.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => outStale.push(st), getKey: () => Promise.resolve('k'),
      callAI: () => Promise.resolve({ ok: true, text: 'x' })
    });
    assert(outStale[outStale.length - 1].state === 'cannot',
      'stale non-YouTube listener degrades to guidance, never a wrong summary');

    const dK = makeDeps();
    const outK = [];
    await YouTube.runYouTubeSummarise({
      panel: dK.panel, scripting: dK.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: (st) => outK.push(st), getKey: () => Promise.resolve(null),
      callAI: () => { throw new Error('callAI must not run without a key'); }
    });
    assert(outK[outK.length - 1].state === 'missing-key', 'missing key -> settings hint (EC-W1-07)');

    const outND = [];
    await YouTube.runYouTubeSummarise({ render: (st) => outND.push(st) });
    assert(outND[outND.length - 1].state === 'unavailable', 'missing deps -> unavailable, no throw');

    // Slice 1.7.1 language token reaches the YouTube prompt.
    global.SahayakLanguage = { current: () => 'hinglish' };
    const dL = makeDeps();
    await YouTube.runYouTubeSummarise({
      panel: dL.panel, scripting: dL.scripting, parseUrl: YouTubeUrl.parseYouTubeUrl,
      render: () => {}, getKey: () => Promise.resolve('k'),
      callAI: (opts) => { promptSeen = opts.prompt; return Promise.resolve({ ok: true, text: 'ok' }); }
    });
    assert(promptSeen.indexOf('Hinglish') !== -1,
      'hinglish preference injects the language token into the YouTube prompt');
    delete global.SahayakLanguage;
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
