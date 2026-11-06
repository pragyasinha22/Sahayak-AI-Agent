/**
 * Sahayak — Vendored Readability integrity tests (Slice 1.4.1 verification)
 * -----------------------------------------------------------------------------
 * Closes the audit's provenance gap for vendor/Readability.js WITHOUT any
 * dependency, network call, or jsdom. Two layers:
 *
 *   1. Byte-level pin. The vendored file was verified on 2026-11-03 to be
 *      byte-identical to mozilla/readability commit
 *      ab4027a8b37669745016869a37a504727992b2ba (master AFTER the 0.6.0 tag —
 *      NOT the 0.6.0 release blob; see vendor/NOTICE). Verification method:
 *      the GitHub contents API for that ref reported blob SHA-1
 *      5cff4540c63fa2dd1471804ac7c919bd988638ce for a 90,944-byte file whose
 *      decoded bytes compared equal to our copy. These pins re-prove the
 *      bytes locally on every run: any drift (tampering, accidental edit,
 *      silent "upgrade") fails the suite. The git blob SHA is recomputed
 *      here with Node's built-in crypto using git's own
 *      sha1("blob <len>\0" + content) formula — no git binary needed.
 *
 *   2. Real-engine smoke. The ACTUAL engine file is required and exercised
 *      in Node: the export shape upstream ships (CommonJS export block) must
 *      be intact, the class must construct-parse, and its input guard must
 *      throw the documented message for a non-document. This runs genuine
 *      vendor code — unlike the mocked parse() results in
 *      article-extract.test.js. Full DOM extraction behaviour still requires
 *      a browser (Chrome test) or jsdom (not approved — zero-dependency rule).
 *
 * Run with:   node tests/unit/readability-integrity.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VENDOR_PATH = path.join(__dirname, '..', '..', 'vendor', 'Readability.js');

// Pins from the verified upstream bytes (vendor/NOTICE documents the source).
const PINNED_BYTES = 90944;
const PINNED_SHA256 = 'e9330028c8a5a4aa7d75147be2605d520f7f213c7b28474947dc0e9c984e9bed';
const PINNED_GIT_BLOB_SHA1 = '5cff4540c63fa2dd1471804ac7c919bd988638ce';

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

function gitBlobSha1(buf) {
  return crypto
    .createHash('sha1')
    .update('blob ' + buf.length + '\0')
    .update(buf)
    .digest('hex');
}

function main() {
  // ==========================================================================
  // 1. Byte-level integrity of the vendored engine.
  // ==========================================================================
  section('vendored bytes match verified upstream commit');
  {
    assert(fs.existsSync(VENDOR_PATH), 'vendor/Readability.js exists');
    const buf = fs.readFileSync(VENDOR_PATH);
    assert(buf.length === PINNED_BYTES,
      'file is exactly ' + PINNED_BYTES + ' bytes (pinned upstream size)');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    assert(sha256 === PINNED_SHA256, 'SHA-256 matches the pinned verified digest');
    assert(gitBlobSha1(buf) === PINNED_GIT_BLOB_SHA1,
      'git blob SHA-1 matches the blob hash upstream reports for commit ab4027a8');

    const text = buf.toString('utf8');
    assert(text.indexOf('Copyright (c) 2010 Arc90 Inc') !== -1,
      'upstream copyright header preserved unmodified');
    assert(text.indexOf('Apache') !== -1, 'Apache license notice present');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'vendor', 'LICENSE.md')),
      'vendor/LICENSE.md ships alongside the code');
    assert(fs.existsSync(path.join(__dirname, '..', '..', 'vendor', 'NOTICE')),
      'vendor/NOTICE records the provenance');
    assert(/module\.exports\s*=\s*Readability/.test(text),
      'upstream CommonJS export block intact (injected + Node-loadable)');
  }

  // ==========================================================================
  // 2. Real-engine smoke: load and execute actual vendor code in Node.
  // ==========================================================================
  section('real engine loads and guards inputs');
  {
    const Readability = require(VENDOR_PATH);
    assert(typeof Readability === 'function',
      'the real exported Readability class loads in Node');
    assert(typeof Readability.prototype.parse === 'function',
      'parse() exists on the real prototype');

    let threw = '';
    try { new Readability({}); } catch (e) { threw = String(e.message || e); }
    assert(threw.indexOf('First argument to Readability constructor') === 0,
      'constructor rejects a non-document with the documented upstream error');

    let threwNull = '';
    try { new Readability(null); } catch (e) { threwNull = String(e.message || e); }
    assert(threwNull.length > 0, 'null document is rejected, not silently accepted');
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

try {
  main();
} catch (err) {
  console.error('Harness error:', err);
  process.exit(2);
}
