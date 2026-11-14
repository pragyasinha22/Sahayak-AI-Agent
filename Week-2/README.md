# Sahayak

**AI-powered Chrome side-panel browser assistant.**

Sahayak reads the page you are viewing, explains selections, summarises articles and public YouTube videos, and (in later weeks) answers questions grounded in that page and helps you complete browser tasks **one approved step at a time**. All AI network calls live in the Side Panel; content scripts never see API keys. There is **no backend** — everything runs inside Chrome.

---

## Current status — Week 1 complete in code

This repository is being built slice-by-slice according to
[`docs/implementation-plan.md`](./docs/implementation-plan.md).

| Slice | Feature | Status |
|---|---|---|
| **1.1.1** | MV3 manifest + background service worker + toolbar action | ✅ Implemented · manually verified in Chrome |
| **1.1.2** | Side Panel shell + panel-open binding | ✅ Implemented · manually verified |
| **1.1.3** | Settings + Gemini API-key storage | ✅ Implemented · manually verified |
| **1.1.4** | Panel ↔ background ↔ content message router | ✅ Implemented · manually verified |
| **1.2.1** | Pure safety module skeleton (policy + rules + classifiers) | ✅ Implemented · 237 unit assertions |
| **1.2.2** | Safety gate wired around panel egress points | ✅ Implemented · manually verified (both bypass checks) |
| **1.3.1** | Selection capture + Explain in panel | ✅ Implemented — on any page via the gate-checked on-demand arm path (activeTab; no broad host grants) |
| **1.4.1** | Readability article extraction + noise removal | ✅ Implemented — vendored Mozilla Readability, byte-verified against upstream commit `ab4027a8` (post-0.6.0 master; see `vendor/NOTICE`) |
| **1.5.1** | Structured article summary (TL;DR · 5 key points · next actions) | ✅ Implemented · 30 unit assertions |
| **1.6.1** | YouTube summarisation (transcript/timestamp chapter notes) | ✅ Implemented · 38 unit assertions |
| **1.7.1** | English / Hinglish response-language toggle | ✅ Implemented · 27 unit assertions |
| **1.8.1** | Chrome built-in AI probe (assignment: **optional**) | ⏳ Not started — non-blocking by design |
| … | Later weeks (chat, context menus, screenshots, agent, profile, skills, distribution) | ⏳ Not started |

Manual Chrome acceptance for Slices 1.3.1–1.7.1 is pending on the user's side
(see *Week-1 manual acceptance* below); unit-test evidence is all green
(543 assertions across 10 suites).

### How Week 1's features work

- **Explain (1.3.1).** Select text on a page → the panel shows the selection →
  press **Explain** → the read gate runs on the tab's URL *before* anything
  leaves the page; only the bounded plain-text selection (≤ 2,000 chars,
  never page HTML) goes to Gemini. On pages outside the declarative demo
  match, pressing Explain first **arms** selection capture: the gate runs,
  then `content/selection.js` is injected on demand under the existing
  `activeTab` + `scripting` grants — no broad host permissions were added.
- **Extract (1.4.1).** Press **Extract** → gate → on-demand injection of the
  vendored `vendor/Readability.js` (Mozilla readability, commit `ab4027a8` —
  byte-verified against upstream, see `vendor/NOTICE`) + `content/article-reader.js`
  → the adapter returns
  only `{ title, byline, textContent, truncated }` (GDR-7: raw HTML never
  leaves the page).
- **Summarise (1.5.1).** Reuses the 1.4.1 extraction, sends the plain text +
  a strict three-section template to Gemini, and parses the reply into
  **exactly 1 TL;DR line, 5 key points and a next-actions list** — a reply
  that doesn't meet the structure is refused with a retry message rather
  than half-rendered. Pages without enough readable text get the
  "page doesn't say enough" refusal; nothing is ever invented.
- **YouTube (1.6.1).** On a public watch page press **Summarise video** →
  gate → URL validation (`shared/youtube-url.js`: watch / youtu.be / shorts
  / embed / live + 11-char id rules) → `content/youtube-adapter.js` reads
  the video id, title, description chapter timestamps, and (when present)
  the caption track the page already advertises — fetched same-origin, no
  new permissions. Gemini turns the transcript into timestamped chapter
  notes. Private / removed / subtitle-less videos produce a clear *"cannot
  be summarised"* message instead of a crash or a guessed summary.
- **Language toggle (1.7.1).** An **EN | Hinglish** pill in the panel header
  persists to `settings.preferences.language` (via the Slice 1.1.3 storage
  manager) and injects a language instruction into every Explain, Summarise
  and YouTube prompt. Unknown stored values fall back to English.

The safety invariants from Week 1 Phase 1–2 remain unchanged:
`SahayakPanel.guardedSend(...)` is the only sanctioned path for protected
families, blocked requests never reach `chrome.runtime.sendMessage`, and
any unguarded send of a protected family throws `safety-gate-bypass:<family>`
in dev/unpacked builds.

---

## Repository layout (as of Slice 1.7.1)

```
.
├── manifest.json                 # MV3 manifest (permissions: storage, sidePanel,
│                                 #   activeTab, scripting — no host grants)
├── background/
│   ├── service-worker.js         # Panel-open binding + router registration
│   └── router.js                 # SahayakRouter.makeHandler
├── shared/
│   ├── message-contract.js       # Envelope shape + forbidden-field walk
│   └── youtube-url.js            # YouTube URL parse + video-id validation (1.6.1)
├── panel/
│   ├── side-panel.html           # Shell + Explain/Extract/Summary/YouTube cards
│   ├── side-panel.css            # Layout + card + language-toggle styling
│   ├── side-panel.js             # Bootstrap + view toggle + messaging install
│   ├── messaging.js              # SahayakPanel { send, guardedSend, gate, … }
│   ├── safety-gate.js            # Non-bypassable gate around panel egress
│   ├── settings/settings.js      # API-key form + translation target preference
│   ├── ui/language-toggle.js     # EN | Hinglish header pill (1.7.1)
│   ├── prompts/
│   │   ├── article-summary.js    # Summary prompt + 3-section parser (1.5.1)
│   │   ├── translate.js          # Selected-text translation prompt (2.2.2)
│   │   └── draft.js              # Email / LinkedIn / Forum prompts (2.2.2)
│   └── features/
│       ├── context-actions.js    # Gated translate + reply drafting (2.2.2)
│       ├── context-menu.js       # Tab-specific context-menu handoff (2.2.1)
│       ├── explain.js            # Selection → Gemini explain (1.3.1) + arm path
│       ├── extract.js            # Gate → inject → guardedSend (1.4.1)
│       ├── summarise.js          # Extract + Gemini summary + section render (1.5.1)
│       └── youtube.js            # YouTube gate → adapter → chapter notes (1.6.1)
├── content/
│   ├── _placeholder.js           # Demo-site stub (https://example.com/*)
│   ├── selection.js              # Bounded selection capture push (1.3.1)
│   ├── article-reader.js         # Readability adapter — whitelisted result (1.4.1)
│   └── youtube-adapter.js        # Transcript/chapters adapter (1.6.1)
├── state/
│   ├── storage-manager.js        # Namespaced chrome.storage.local wrapper
│   ├── api-keys.js               # get/set/remove + maskKey
│   └── preferences.js            # Language preference + prompt token (1.7.1)
├── safety/
│   ├── rules.js                  # Frozen rule tables (pure data)
│   ├── classifiers.js            # classifyPage / classifyField
│   └── policy.js                 # decideRead / decideAction (deny-biased)
├── vendor/
│   ├── Readability.js            # Mozilla Readability @ commit ab4027a8 (verified)
│   ├── LICENSE.md                # Apache-2.0 (upstream)
│   └── NOTICE                    # Provenance + pinned hashes (see tests below)
├── icons/                        # Toolbar/store icons 16/32/48/128 (Slice 1.1.1)
├── tests/
│   └── unit/                     # Plain-Node suites, zero dependencies
│       ├── storage-manager.test.js   #  16 assertions (1.1.3)
│       ├── router.test.js            #  34 (1.1.4)
│       ├── safety-policy.test.js     # 237 (1.2.1)
│       ├── safety-gate.test.js       #  83 (1.2.2)
│       ├── selection-explain.test.js #  38 (1.3.1 + arm path + language)
│       ├── article-extract.test.js   #  27 (1.4.1)
│       ├── readability-integrity.test.js # 13 (1.4.1 provenance + real engine)
│       ├── summarise.test.js         #  30 (1.5.1)
│       ├── youtube.test.js           #  38 (1.6.1)
│       ├── preferences.test.js       #  27 (1.7.1)
│       └── context-actions.test.js   # Context prompts, target and safety flow
└── docs/
    ├── problemStatement.md · architecture.md · implementation-plan.md
    ├── edge-case.md · prompts.md
```

Planned folders that appear in later slices: `providers/`, `agent/`,
`skills/`, `profile/`, `practice/`. The `icons/` set required by the Slice
1.1.1 file list now ships (16/32/48/128 PNGs, wired into `action.default_icon`
and `icons` in the manifest — no permission changes).

---

## Install and run (Chrome *Load unpacked*)

These are the exact steps required by PS §7.1–7.2 and the Slice 1.1.1 acceptance criteria.

1. Open Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the repository root (the folder with `manifest.json`).
3. Click the Sahayak toolbar icon — the Side Panel docks to the right. Header:
   title, status pill, **Chat / Settings** toggle, and the **EN | Hinglish** pill.
4. **Settings → paste a Gemini API key → Save.** Masked display, reveal ~4 s,
   clear, persists across panel close and browser restart. The key never
   appears in any log, routed message, or injected script (GDR-3).
5. Panel DevTools smoke checks (Slices 1.1.4 / 1.2.2):
   ```
   SahayakPanel.ping().then(console.log)                     // → pong (worker)
   SahayakPanel.send('extract-article', { tabId })           // → throws safety-gate-bypass
   SahayakPanel.guardedSend('extract-article', { tabId })    // → the sanctioned path
   ```

### Week-1 manual acceptance (feature flows)

| # | Steps | Expected |
|---|---|---|
| M1 | Open any news/blog article → open the panel → press **Explain** once (arms capture, gate-checked) → select a sentence → press **Explain** again | Gemini explanation renders in the card; on a banking URL the card shows the safety refusal and nothing is sent |
| M2 | Same article → press **Extract** | Clean title + article prose only — no nav/ads/footer/script text |
| M3 | `chrome://extensions` tab → press **Extract** | "reserved page" message; no read attempted (EC-W1-03) |
| M4 | Article → press **Summarise** | Exactly 1 TL;DR line, 5 key points, next-actions list; a page without enough text shows the "page doesn't say" refusal |
| M5 | Public YouTube watch page → **Summarise video** | Timestamped chapter notes; a subtitle-less/private video shows "cannot be summarised" |
| M6 | Toggle **Hinglish** → repeat Explain or Summarise | Reply arrives in Hinglish; toggle back to EN; the choice survives panel close/reopen |
| M7 | PS §7 Definition-of-Done walkthrough | Items 1–7 pass end-to-end |

Slice 1.8.1 (Chrome built-in AI probe) is **optional** per PS §2.7 and does
not block any of the above.

---

## Running the unit tests

Zero dependencies — plain Node, no build step, no npm install:

```
node tests/unit/storage-manager.test.js   # Slice 1.1.3 — storage wrapper
node tests/unit/router.test.js            # Slice 1.1.4 — message router
node tests/unit/safety-policy.test.js     # Slice 1.2.1 — safety policy (237)
node tests/unit/safety-gate.test.js       # Slice 1.2.2 — gate wiring (83)
node tests/unit/selection-explain.test.js # Slice 1.3.1 — clamp/prompt/gate/arm (38)
node tests/unit/article-extract.test.js   # Slice 1.4.1 — adapter + injection (27)
node tests/unit/readability-integrity.test.js # Slice 1.4.1 — provenance pins (13)
node tests/unit/summarise.test.js         # Slice 1.5.1 — parser + pipeline (30)
node tests/unit/youtube.test.js           # Slice 1.6.1 — URL/adapter/pipeline (38)
node tests/unit/preferences.test.js       # Slice 1.7.1 — language (27)
node tests/unit/context-menus.test.js     # Slice 2.2.1 — context-menu handoff
node tests/unit/context-actions.test.js   # Slice 2.2.2 — translate + reply drafts
node tests/unit/page-chat.test.js         # Slice 2.1.1 — page-grounded chat
node tests/unit/session-store.test.js     # Slice 2.1.2 — per-tab chat history
```

Expected (per file): each assertion prints a `✓` line and the run finishes with
`Summary: N passed, 0 failed.` and exit code `0`. Suite totals change as Week-2
coverage is added. The suites mock `chrome.storage.local`,
`chrome.tabs.sendMessage`, `chrome.scripting`, and `fetch` — no real network or
browser is touched. Unit tests prove logic and ordering; real-browser behavior is
covered by the manual acceptance table above.

**Slice 1.5.1 coverage** (`summarise.test.js`): the plan's Unit-tests bullets —
"parser against expected 3-section structure" (well-formed, over-5 trimmed,
under-5 malformed, heading/bullet style variance) and the "'page doesn't say'
path when content is missing". Plus gate→inject→send ordering, blocked pages
injecting/sending nothing, missing-key hint (EC-W1-07), no key in the prompt
(GDR-3), plain-text-only prompt (GDR-7), and reserved-page mapping (EC-W1-03).

**Slice 1.6.1 coverage** (`youtube.test.js`): "URL parser (watch, youtu.be,
shorts) and video-id validation" (13 cases incl. lookalike hosts and bad ids);
"empty-transcript fallback shows refusal message" at both adapter and panel
level; chapter-line parsing with clock validation; json3 caption-event parsing;
transcript clamp; the whitelisted result shape (no HTML can ride along);
gate-before-injection; non-YouTube refusal; language token.

**Slice 1.7.1 coverage** (`preferences.test.js`): "prompt templates include
language token" for all three features; normalisation of corrupt stored values;
persistence through the storage-manager path contract; toggle cache semantics
(panel reopen keeps the choice; invalid values fall back to English).

---

## Security note (from PS §5 and architecture §9)

Sahayak ships **without** any bundled credentials. The user pastes their own
Gemini API key in Settings; it is stored in `chrome.storage.local`, confined to
the Side Panel, and never committed to public source control. Because a
distributed extension's files and runtime are inspectable by anyone with the
extension installed, keys stored this way are **not truly secret**. Treat them
as personal keys, not as shared secrets. Only bounded plain text (selections,
extracted article bodies, transcripts) ever leaves a page — never raw HTML —
and every read passes the deterministic deny-biased gate first.

---

## Known remaining limitations

- **Manual Chrome acceptance pending.** The 543 unit assertions prove logic,
  ordering, and refusal paths, but browser acceptance (steps M1–M7) requires a
  real Gemini API key and a real Chrome session — it can only be performed by
  the user. Week 1 is not signed off until those steps pass.
- **YouTube transcripts are best-effort.** Captions are read from the
  player-response metadata the watch page already advertises (same-origin
  fetch, no new permissions). Videos without caption tracks, with DRM/age
  gates, or private videos produce the documented refusal — there is no
  authentication bypass and none is planned.
- **Declarative content scripts cover only `https://example.com/*`.** On every
  other allowed page, selection capture works through the gate-checked
  on-demand arm path (`activeTab`), which activates after the first Explain
  press on that tab. A page where *Extract* ran before arming can keep a stale
  article listener until reload (the panel then shows the retry guidance).
- **Readability behaviour at full-DOM level is browser-only.** The vendored
  file is byte-verified against upstream `ab4027a8` and its integrity is
  pinned by `readability-integrity.test.js`; end-to-end extraction quality is
  verified by the manual article tests (M2/M4), not by Node (no jsdom — zero
  dependency rule).
- **Stored keys are device-local, not encrypted secrets** (see Security note).
- **1.8.1 Chrome built-in AI probe is optional** per PS §2.7 and is not
  started; nothing in Week 1 depends on it.

---

## Documentation index

- [`docs/problemStatement.md`](./docs/problemStatement.md) — full requirements, four-week plan, functional & non-functional requirements, technical constraints, out-of-scope, definition of done.
- [`docs/architecture.md`](./docs/architecture.md) — five-layer design, Mermaid architecture diagram, process model, provider abstraction, safety engine, orchestrator state machine, storage tiers.
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) — every phase and slice with objective, features, files, dependencies, steps, acceptance, Chrome tests, unit tests.
- [`docs/edge-case.md`](./docs/edge-case.md) — failure modes and safety-preserving behaviour with testing priorities.

---

## Development rules Week 1 obeys

Referenced from `docs/implementation-plan.md` §0:

- **GDR-1** MV3 only.
- **GDR-2** No backend.
- **GDR-3** AI calls in the Side Panel; keys never reach content scripts. Enforced at the router boundary (`shared/message-contract.js` recursive forbidden-field walk) and in every feature test.
- **GDR-6** Fixed message-contract families — YouTube reuses `extract-article` with a `kind` marker instead of adding a family.
- **GDR-7** Raw page HTML never leaves a page; adapters return whitelisted plain text.
- **GDR-9** No future-week features leaked into Week 1: no chat, no orchestrator, no provider abstraction beyond the single documented Gemini call pattern.

---

*End of Week 1. Await approval before starting Week 2 (page chat, context menus, screenshots).*
