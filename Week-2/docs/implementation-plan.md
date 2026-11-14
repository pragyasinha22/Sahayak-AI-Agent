# Sahayak – Phase-Wise Implementation Plan

This plan operationalises [`problemStatement.md`](./problemStatement.md) and [`architecture.md`](./architecture.md). It contains **no application code** — only phases, slices, files, tests, and acceptance gates. Every slice must run in Chrome and pass its acceptance criteria before the next slice starts, per problem-statement §8.

---

## 0. Global Development Rules (apply to every slice)

Sourced from problem-statement §5, §8 and architecture §2, §3, §6, §9.

| ID | Rule |
|---|---|
| GDR-1 | **Chrome MV3 only.** No MV2 constructs, no persistent background page. |
| GDR-2 | **No backend.** All logic runs inside the extension process model. |
| GDR-3 | **AI network calls live only in the Side Panel.** Content scripts never hold, receive, or see API keys (PS §8, Arch §3.3). |
| GDR-4 | **Approval is architectural.** Every browser action requires an approval token produced by the panel review step; the executor cannot self-originate actions. |
| GDR-5 | **Safety module is pure, deterministic, independently testable, introduced in Week 1** (PS §8, Req 9) and consulted on every read and action path. |
| GDR-6 | **Approval & task progress persist in `chrome.storage.session`** (PS §8, Req 11). Profile, keys, skills in `chrome.storage.local`. |
| GDR-7 | **Never send full raw HTML to the model** — only Readability text, the compact action map, or a cropped screenshot. |
| GDR-8 | **Do not invent features** outside PS §1–§8 and Arch §1–§14. Out-of-scope items in PS §6 are never implemented. |
| GDR-9 | **Do not reorder instructor slices.** Later-week features must not leak into earlier phases. |
| GDR-10 | **Keys stay out of source control** — never committed, always documented as not-truly-secret (PS §5 security note). |
| GDR-11 | **Every slice adds unit tests** for its pure modules (safety, validator, map builder, provider layer). |
| GDR-12 | **Chrome manual test is mandatory** — panel interactions, empty states, and error states must be exercised (PS §8). |

### Slice format used below

Every slice is described with: **Objective · Features · Components · Files · Depends · Steps · Acceptance · Chrome test · Unit tests · Result.**

---

## 1. Week 1 — "The Eyes": Read the Web

**Week goal:** extension shell, side panel, settings, selected-text explanation, Readability article extraction + summary, YouTube summary, English/Hinglish toggle. Optional offline probe last.
**Week exit gate:** PS §7 DoD items 1–7 must all pass in Chrome before Week 2 starts.

### Phase 1.1 — Chrome Extension Foundation (PS §2.1)

Build the skeleton before any intelligence. The Safety module is co-introduced here (Req 9 / GDR-5) so every later read path is already gated.

#### Slice 1.1.1 — MV3 manifest, service worker skeleton, action icon

- **Objective:** Register a loadable, unpacked MV3 extension with a background service worker and a toolbar action.
- **Features:** Manifest V3 (PS §2.1, Arch §4).
- **Components:** `manifest.json`, background service worker, toolbar `action`.
- **Files:** create `manifest.json`, `background/service-worker.js`, `icons/*.png`, `README.md` (skeleton).
- **Depends:** none.
- **Steps:** declare `manifest_version: 3`; declare `action.default_title/icon`; declare `background.service_worker`; declare `permissions: ["storage"]`; keep host permissions empty at this point.
- **Acceptance:** Chrome → *Extensions* → **Load unpacked** succeeds; toolbar icon visible; service-worker log line prints on install; no manifest errors.
- **Chrome test:** Load unpacked; click icon; open service-worker console; confirm registration; reload after edits.
- **Unit tests:** none (declarative config only).
- **Result:** Extension is installable through *Load unpacked* (PS §7.1–7.2).

#### Slice 1.1.2 — Side Panel shell + panel-open binding

- **Objective:** Provide the persistent side-panel UI as the primary interface (FR-1, Arch §3.1).
- **Features:** Chrome Side Panel API; opening on action click.
- **Components:** `panel/side-panel.html`, `panel/side-panel.css`, `panel/side-panel.js`, `permissions: sidePanel`.
- **Files:** create `panel/*`; modify `manifest.json` (add `side_panel.default_path`, permission); modify `background/service-worker.js` (open-on-action, per-tab binding).
- **Depends:** 1.1.1.
- **Steps:** register `side_panel.default_path`; on `action.onClicked`, call `sidePanel.open({ tabId, windowId })`; wire `sidePanel.setOptions` to bind panel to the active tab; add empty layout containers (header, chat area, review area, footer).
- **Acceptance:** Clicking the toolbar icon opens the panel docked to the current window; panel state survives focus changes; closing/reopening works.
- **Chrome test:** load unpacked, click icon, observe docked panel; switch tabs; verify panel follows; verify `chrome.runtime.getURL` returns panel path.
- **Unit tests:** none (DOM/extension API).
- **Result:** FR-1 satisfied; panel is the sole surface for AI + approvals.

#### Slice 1.1.3 — Settings screen + Gemini API key storage

- **Objective:** Let users configure their own Gemini key and preferences (PS §2.1, FR-2).
- **Features:** Settings tab inside panel; key persisted in `chrome.storage.local`; documented non-secret caveat.
- **Components:** `panel/settings/`, `state/storage-manager.js`, `state/api-keys.js`.
- **Files:** create `panel/settings/settings.{html,css,js}`, `state/storage-manager.js`; modify `panel/side-panel.*` to add Settings route.
- **Depends:** 1.1.2.
- **Steps:** add Settings form field for Gemini key; on save, write to `chrome.storage.local` under a namespaced key; on load, hydrate masked value; never log the key; render a persistent note that keys in a distributed extension are not truly secret (PS §5 note, Arch §9).
- **Acceptance:** Key round-trips through reload; masked in UI; nothing key-bearing appears in console or source; settings persist across browser restart.
- **Chrome test:** enter a fake key, save, close panel, reopen — value hydrated masked; inspect `chrome.storage.local` via devtools source panel; confirm no key in code files.
- **Unit tests:** `storage-manager` — set/get, missing-key path, namespacing.
- **Result:** FR-2 satisfied; keys available only to the Side Panel process (GDR-3).

#### Slice 1.1.4 — Panel ↔ background ↔ content message router

- **Objective:** Establish the thin coordinator channel used by every later slice (Arch §3.2, §8.1).
- **Features:** structured request/response envelopes.
- **Components:** `background/router.js`, `panel/messaging.js`, `content/_placeholder.js`.
- **Files:** create `background/router.js`, `panel/messaging.js`, `shared/message-contract.js`.
- **Depends:** 1.1.2, 1.1.3.
- **Steps:** define envelope `{ id, family, payload, source }`; families reserved: `extract-article`, `scan-elements`, `capture-screenshot`, `execute-approved`; wire `chrome.runtime.onMessage` in worker; worker routes panel↔tab; drop requests for unknown families.
- **Acceptance:** Panel sends a `ping` payload; router returns `pong`; content-script target resolved by `tabId`; no key ever crosses into a routed message (assert in router).
- **Chrome test:** from panel devtools console, call router; observe routing to a stub content script on a demo page.
- **Unit tests:** router validates envelope shape; rejects missing `family`, rejects unknown `family`, rejects payloads carrying `apiKey`.
- **Result:** communication spine ready for every later flow (GDR-3).

### Phase 1.2 — Safety Module Foundation (Req 9 / PS §8 "safety early")

Placed before any page-read or action feature. Introduced here as a pure module; expanded in later weeks; **hardened to full §2.20 coverage in Week 4**.

#### Slice 1.2.1 — Pure safety module skeleton

- **Objective:** Stand up a deterministic policy module usable by every read/action path.
- **Features:** decision enum `allow | require-confirm | block`; page classifier; field classifier (initial rules).
- **Components:** `safety/policy.js`, `safety/rules.js`, `safety/classifiers.js`.
- **Files:** create those three.
- **Depends:** 1.1.4.
- **Steps:** expose pure functions `classifyPage(url, hints)`, `classifyField(elementDescriptor)`, `decideRead(pageClass)`, `decideAction(actionType, targetClass, pageClass)` — no I/O, no async, no AI; ship rule set seeded with §2.20 items (banking/payment host list, password/OTP/card field hints, Submit/Pay/Send label list) so gates are already meaningful.
- **Acceptance:** every call returns one of three enums; module is deterministic across identical inputs; no `fetch`, no `chrome.*` inside it.
- **Chrome test:** none needed (pure module). Loaded in unit tests via Node/jsdom.
- **Unit tests:** table-driven — known banking hosts → `block`; password-type input → `block`; label "Card number" → `block`; label "Submit" → `require-confirm`; benign marketing page → `allow`.
- **Result:** Every later read/action path has a mandatory gate it can call (Req 9, GDR-5).

#### Slice 1.2.2 — Wire safety gate around panel egress points

- **Objective:** Make the gate non-bypassable: every page-read or content-script command must consult it.
- **Features:** read-gate, action-gate helpers.
- **Components:** `panel/safety-gate.js`.
- **Files:** create `panel/safety-gate.js`; modify `panel/messaging.js`.
- **Depends:** 1.2.1.
- **Steps:** `panel/safety-gate` imports the pure module; exposes `guardRead(pageInfo)` and `guardAction(envelope)`; router refuses to send `extract-article` or `execute-approved` unless the gate allowed it; UI path for `require-confirm` shows a confirmation prompt.
- **Acceptance:** attempts to send reads on a blocked host never reach the router; attempts without going through the gate throw in dev/test builds.
- **Chrome test:** load a `bank.example.com` mock page, ask panel to "Read page" → shows *Blocked by safety*; load a news page → allowed.
- **Unit tests:** gate calls policy with correct inputs; blocked inputs never produce a routed message; `require-confirm` yields a promise that resolves only on confirm.
- **Result:** Safety becomes architectural (Arch §6.1).

### Phase 1.3 — Selected Text Explanation (PS §2.2)

#### Slice 1.3.1 — Content-script selection capture + panel display

- **Objective:** Let the user select text and read the AI explanation inside the side panel.
- **Features:** selection listener; read-gate; Gemini explain call (text only).
- **Components:** `content/selection.js`, `panel/features/explain.js`.
- **Files:** create those; modify `panel/side-panel.html` to add Explain card.
- **Depends:** 1.1.4, 1.2.2.
- **Steps:** on `mouseup` in content script, capture `window.getSelection().toString()` (bounded size); forward via router to panel; panel reads key from storage, calls Gemini lightweight with an "explain this text" prompt; renders result in the Explain card; **never** send key to content script (GDR-3).
- **Acceptance:** selecting text and pressing Explain produces a visible answer in the panel; long selections truncated gracefully; safety gate runs before any read.
- **Chrome test:** open any article page, select a paragraph, click *Explain* button in panel; result renders; try on a page classified `block` — refused with reason.
- **Unit tests:** selection length clamp; prompt template contains no page HTML; error path when key missing shows understandable message.
- **Result:** First end-to-end "eyes → brain" slice; establishes the Gemini-call pattern used everywhere.

### Phase 1.4 — Article Extraction (PS §2.3)

#### Slice 1.4.1 — Readability.js integration + extract flow

- **Objective:** Extract clean title + main content; strip nav/ads/sidebars/footers.
- **Features:** Mozilla Readability.js in isolated world; content clone document.
- **Components:** `vendor/Readability.js`, `content/article-reader.js`.
- **Files:** add vendored `Readability.js`; create `content/article-reader.js`; modify router to handle `extract-article`.
- **Depends:** 1.1.4, 1.2.2, 1.3.1.
- **Steps:** inject `article-reader` on demand via `chrome.scripting`; content clones `document`, runs `new Readability(clone).parse()`; returns `{ title, byline, textContent }` only — never raw HTML (GDR-7); panel calls read-gate first.
- **Acceptance:** blog/news sample returns readable prose; noise elements excluded; content script has no access to keys.
- **Chrome test:** open a typical news article; click *Extract* in panel; result shown as text; verify no `<script>`/`<nav>` content in output.
- **Unit tests:** adapter shape (missing `title` → fallback to hostname); oversized text clamped.
- **Result:** FR-3 satisfied; foundation for summarisation and page chat.

### Phase 1.5 — Article Summarisation (PS §2.4)

#### Slice 1.5.1 — Structured TL;DR / five points / next actions

- **Objective:** Generate the required three-section summary from extracted article text.
- **Features:** prompt template, lightweight Gemini call, structured result rendering.
- **Components:** `panel/features/summarise.js`, `panel/prompts/article-summary.js`.
- **Files:** create those; modify panel UI to add Summary view.
- **Depends:** 1.4.1.
- **Steps:** send extracted text + summary template to Gemini (lightweight model); parse returned markdown into three sections; render TL;DR, five bullets, and "What to do next"; if model unavailable → graceful error (PS §2.11 pattern reused in Week 2).
- **Acceptance:** summary always contains exactly 1 TL;DR line, 5 key points, and next-action list; content grounded only in the page (Arch §5.4).
- **Chrome test:** summarise a known article; verify the three sections; click again to check idempotency.
- **Unit tests:** parser for expected three-section shape; "page doesn't say" path when content missing.
- **Result:** FR-4 (articles half) satisfied.

### Phase 1.6 — YouTube Summarisation (PS §2.5)

#### Slice 1.6.1 — Transcript/chapter fetch + chapter-style notes

- **Objective:** Summarise supported public YouTube videos with timestamped chapters; handle inaccessible videos gracefully.
- **Features:** YouTube detection; transcript/timestamps when available; private/out-of-scope handled.
- **Components:** `panel/features/youtube.js`, `content/youtube-adapter.js`, `shared/youtube-url.js`.
- **Files:** create those.
- **Depends:** 1.5.1.
- **Steps:** detect `youtube.com/watch`, `youtu.be`; adapter extracts video id + available transcript/timestamps from page (public only); panel calls Gemini for chapter notes; if no transcript or non-public, respond "This video cannot be summarised" (PS §2.5); never attempt to bypass private videos (PS §6).
- **Acceptance:** supported public video returns chapter notes with timestamps; unsupported/private returns the standard "cannot be summarised" message; no crash path.
- **Chrome test:** open a public video with transcript, click *Summarise*; open a private video → refusal message.
- **Unit tests:** URL parser (watch, youtu.be, shorts); empty-transcript fallback.
- **Result:** FR-4 (YouTube) satisfied.

### Phase 1.7 — Language Support (PS §2.6)

#### Slice 1.7.1 — English / Hinglish toggle persisted, threaded into prompts

- **Objective:** Let the user switch assistant response language.
- **Features:** UI toggle; persisted preference; prompt injection.
- **Components:** `panel/ui/language-toggle.js`, `state/preferences.js`.
- **Files:** create those; modify `panel/side-panel.html`, `panel/prompts/article-summary.js`, `panel/features/explain.js`.
- **Depends:** 1.1.3, 1.3.1, 1.5.1, 1.6.1.
- **Steps:** toggle writes preference to `chrome.storage.local` (via storage-manager); every panel prompt includes `language: en | hinglish`; summary/explain/youtube renderers respect preference.
- **Acceptance:** switching language immediately affects the next response; persisted across reload; page-chat (Week 2) inherits the same field.
- **Chrome test:** toggle to Hinglish, click Explain on a paragraph, response in Hinglish; toggle to English, next response in English.
- **Unit tests:** preference hydration; prompt template contains language token.
- **Result:** PS §2.6 satisfied.

### Phase 1.8 — Optional Offline Support (PS §2.7, non-blocking)

#### Slice 1.8.1 — Chrome built-in AI feature probe (optional path)

- **Objective:** Detect Chrome built-in summarisation; use when available, otherwise fall through to Gemini.
- **Features:** capability probe; graceful skip.
- **Components:** `panel/features/offline-summarise.js`.
- **Files:** create it; modify `panel/features/summarise.js` to check probe first.
- **Depends:** 1.5.1.
- **Steps:** probe for `window.LanguageModel` or equivalent Chrome built-in AI surface; if available and device supports it, use for TL;DR-style summary; else skip (never blocks core flow).
- **Acceptance:** feature is optional; when disabled, existing Gemini path is unchanged.
- **Chrome test:** with the built-in unavailable, verify no code path breaks.
- **Unit tests:** probe returns false in unsupported build → path skipped.
- **Result:** PS §2.7 met, non-blocking.

### Week 1 Exit Checklist

- Load unpacked works (DoD 1–2).
- Panel opens and Settings accepts a key (DoD 3–4).
- Article summary + YouTube summary render (DoD 5–6).
- Language toggle works (DoD 7).
- Safety module loaded and gates reads (Req 9).

---

## 2. Week 2 — "The Brain": Understand Page and Screen

**Week goal:** page chat, context-menu actions, screenshot-and-ask, provider reliability with Groq fallback and tiering, plus sensitive-page read gate extension.
**Week exit gate:** PS §7 DoD items 8–10 pass.

### Phase 2.1 — Chat With the Current Page (PS §2.8)

#### Slice 2.1.1 — Page-grounded chat with strict grounding rule

- **Objective:** Answer user questions using only page content; say "the page does not provide this" otherwise.
- **Features:** context assembly, grounding prompt, refusal response.
- **Components:** `panel/features/chat.js`, `panel/prompts/page-chat.js`.
- **Files:** create those; modify panel UI to add chat input + history.
- **Depends:** 1.4.1, 1.2.2, 1.7.1.
- **Steps:** on submit, fetch page content via Readability slice, pass as `pageContext`; prompt instructs: answer **only** from `pageContext`; if not found, output a fixed "page does not provide" string; render answer.
- **Acceptance:** answers on info present, refusal on info absent, no hallucination escape hatch.
- **Chrome test:** open article about X; ask "What does this page say about Y?"; verify refusal; ask about X; verify grounded answer.
- **Unit tests:** refusal constant; prompt always includes language preference + pageContext field.
- **Result:** FR-5 satisfied for non-streaming.

#### Slice 2.1.2 — Conversation history in `chrome.storage.session`

- **Objective:** Maintain history for the active conversation without persisting to disk.
- **Features:** session-scoped history.
- **Components:** `state/session-store.js`.
- **Files:** create; modify `panel/features/chat.js`.
- **Depends:** 2.1.1.
- **Steps:** store `{ tabId → messages[] }` in `chrome.storage.session`; cap message count/size; clear on tab close; **never** write history to `.local` (Req 11, Arch §9).
- **Acceptance:** history preserved within a session; gone after browser restart; tab-scoped isolation.
- **Chrome test:** send 3 messages; reopen panel; history intact; restart Chrome; history empty.
- **Unit tests:** cap logic; per-tab isolation; missing tab cleanup.
- **Result:** PS §2.8 history satisfied.

#### Slice 2.1.3 — Streaming responses

- **Objective:** Progressive token rendering when the API supports it.
- **Features:** provider stream.
- **Components:** modify `panel/features/chat.js`, `providers/gemini-stream.js`.
- **Files:** create `providers/gemini-stream.js`.
- **Depends:** 2.1.1.
- **Steps:** when Gemini endpoint supports streaming, consume chunk feed and re-render; keep refusal constant compatible with stream terminator; if provider doesn't support, fall back to single-response path.
- **Acceptance:** progressive text visible; no partial-JSON corruption in page-chat.
- **Chrome test:** ask a long-answer question; observe token-by-token render.
- **Unit tests:** chunk joiner; stream error → graceful stop with message.
- **Result:** PS §2.8 streaming satisfied.

### Phase 2.2 — Context Menu Actions (PS §2.9)

#### Slice 2.2.1 — Background-registered context menus routed to panel

- **Objective:** Right-click → *Explain this* / *Translate this* / *Draft a reply*.
- **Features:** `contextMenus` API; selection forwarding.
- **Components:** `background/context-menus.js`.
- **Files:** create; modify `manifest.json` (permission `contextMenus`); modify router to accept `context-action` family.
- **Depends:** 1.1.4, 1.3.1.
- **Steps:** register menu items for selection context on worker install; on click, worker forwards selected text + action to panel via router; panel opens if not already open (sidePanel API).
- **Acceptance:** right-clicking selection shows the three actions; result rendered in panel; nothing key-related crosses into content.
- **Chrome test:** select text on any page → right-click → *Explain* → panel opens with answer.
- **Unit tests:** registration shape; selection-length guard.
- **Result:** PS §2.9 entry points wired.

#### Slice 2.2.2 — Translate + Draft reply variants (Email / LinkedIn / Forum)

- **Objective:** Implement the three draft contexts and translation output.
- **Features:** prompt templates per context.
- **Components:** `panel/prompts/draft.js`, `panel/prompts/translate.js`.
- **Files:** create those; modify panel UI to add context picker for Draft.
- **Depends:** 2.2.1, 1.7.1.
- **Steps:** Translate uses preference target language (or Hindi per PS §2.9); Draft presents three contexts; each uses a template with tone + page context (never full HTML); safety gate runs on read.
- **Acceptance:** each of the three Draft variants renders correctly; translation respects selected language.
- **Draft factuality/style:** use only explicit, relevant project facts; omit unrelated facts and clarify unsupported parts. Keep the same supported facts across Email, LinkedIn, and Forum while giving each a distinct reply structure.
- **Chrome test:** select a LinkedIn comment; *Draft a reply* → context picker → email variant reply appears.
- **Unit tests:** three distinct templates; refusal on empty selection.
- **Result:** FR-5/PS §2.9 satisfied.

### Phase 2.3 — Screenshot-and-Ask (PS §2.10)

#### Slice 2.3.1 — Visible-tab capture with crop UI

- **Objective:** Capture the visible browser tab; let user focus/crop/restrict before analysis.
- **Features:** `tabs.captureVisibleTab`; crop UI in panel.
- **Components:** `panel/features/screenshot.js`, `content/crop-driver.js`.
- **Files:** create; modify `manifest.json` (permission `tabs`); modify router to accept `capture-screenshot`.
- **Depends:** 1.1.4, 1.2.2.
- **Steps:** panel triggers `captureVisibleTab`; image buffered in panel; user drags crop box over preview; final image sent to Gemini (vision), never to Groq (Arch §5.1); screenshot data stays in panel memory, not persisted.
- **Acceptance:** capture works; crop applies; only the cropped image leaves the browser.
- **Chrome test:** open a page with a chart; click *Screenshot-and-Ask*; crop to chart; ask question; answer references visible chart values.
- **Unit tests:** crop coordinates clamped; oversized images reduced.
- **Result:** FR-6 satisfied.

#### Slice 2.3.2 — Gemini vision Q&A path

- **Objective:** Answer questions about charts, diagrams, forms, error messages.
- **Features:** vision prompt, image + text in one call.
- **Components:** `providers/gemini-vision.js`, `panel/prompts/screenshot-qa.js`.
- **Files:** create.
- **Depends:** 2.3.1.
- **Steps:** route to **Gemini only** (never eligible for Groq); enforce "answer only from image" grounding rule; on missing model response, understandable error.
- **Acceptance:** vision Q&A works; Groq path never receives an image request.
- **Chrome test:** capture an error dialog; ask "what does this say?"; correct text.
- **Unit tests:** eligibility guard rejects image + Groq combination.
- **Result:** PS §2.10 satisfied; PS §2.11 eligibility seeded.

### Phase 2.4 — API Reliability and Free-Tier Resilience (PS §2.11)

#### Slice 2.4.1 — Provider abstraction + retry/backoff on 429

- **Objective:** Centralise resilience so UI/orchestrator are simple (Arch §5.3).
- **Features:** HTTP 429 handling, exponential backoff, bounded attempts.
- **Components:** `providers/base.js`, `providers/retry.js`, `providers/gemini.js`, `providers/groq.js`.
- **Files:** create; modify every earlier feature to call through provider abstraction.
- **Depends:** 1.3.1, 1.5.1, 2.1.1, 2.3.2.
- **Steps:** unify `callAI(task)` on abstraction; retry with exponential backoff and jitter; on exhausted retries return `UnavailableError`; UI renders understandable error message.
- **Acceptance:** simulated 429 causes bounded retries then graceful error; no crash path.
- **Chrome test:** inject a fake 429 (devtools network throttle/mock); observe backoff pattern; observe final user-facing error message.
- **Unit tests:** attempt ceiling; jitter range; error class mapping.
- **Result:** PS §2.11 retry portion satisfied.

#### Slice 2.4.2 — Model tiering (light default, strong on necessity)

- **Objective:** Cost model per PS §2.11 / §4.4.
- **Features:** tier decision function.
- **Components:** `providers/tiering.js`.
- **Files:** create; modify `providers/base.js`.
- **Depends:** 2.4.1.
- **Steps:** default lightweight Gemini; escalate to stronger when: JSON validation failed on prior attempt, task marked complex (multi-step action, dense visual), or explicit user override; never escalate for trivial text tasks.
- **Acceptance:** normal tasks use lightweight; forced-complex use strong; cost model preserved.
- **Chrome test:** trigger a JSON-invalid page-chat scenario; verify second call uses stronger model.
- **Unit tests:** tier decision table.
- **Result:** PS §2.11 tiering satisfied.

#### Slice 2.4.3 — Groq text-only fallback for eligible tasks

- **Objective:** Free-tier resilience via provider fallback.
- **Features:** eligibility gate; Groq adapter.
- **Components:** `providers/eligibility.js`.
- **Files:** create; modify `providers/base.js`.
- **Depends:** 2.4.1.
- **Steps:** any task carrying an image, or requiring strict multi-modal reasoning → **not** eligible for Groq (Arch §5.1); eligible: page chat, translate, draft reply, text-only summarise, JSON action selection; on Gemini unavailable + eligible task, route to Groq; else return understandable error.
- **Acceptance:** vision requests never routed to Groq; Groq works when Gemini is down.
- **Chrome test:** mock Gemini as unavailable; run text-only translate → served by Groq; run screenshot Q&A → returns understandable error, not routed to Groq.
- **Unit tests:** eligibility table; vision + Groq combination throws.
- **Result:** PS §2.11 fallback satisfied; Arch §5.1 enforced.

#### Slice 2.4.4 — Understandable errors and graceful degradation

- **Objective:** Never crash; always render actionable message (PS §2.11, §4.5).
- **Features:** centralised error-to-string mapper.
- **Components:** `shared/errors.js`, `panel/ui/error-toast.js`.
- **Files:** create; wire into every panel feature.
- **Depends:** 2.4.1.
- **Steps:** map `RateLimit`, `Unavailable`, `Network`, `SafetyBlock`, `InvalidJSON` to short, kind messages; toast/banner in panel.
- **Acceptance:** no raw stack trace ever surfaces to users.
- **Chrome test:** induce each error class; verify messages.
- **Unit tests:** mapper covers every class; empty message fallback.
- **Result:** PS §2.11 UX error handling satisfied.

### Phase 2.5 — Safety Extension: Sensitive-Page Read Gate (Req 9 continued)

#### Slice 2.5.1 — Wire sensitive-page block before any AI egress

- **Objective:** Avoid sending private/sensitive pages to free-tier AI (PS §2.20, §6).
- **Features:** enhanced page classifier; enforced on every read path.
- **Components:** modify `safety/rules.js`, `safety/classifiers.js`, `panel/safety-gate.js`.
- **Files:** edit those; add tests.
- **Depends:** 1.2.2, 2.1.1, 2.2.2, 2.3.2, 1.5.1, 1.6.1.
- **Steps:** classifier detects bank/pay/health/gov sensitive categories via host + DOM hints; every read path (chat, translate, draft, screenshot, summarise) calls `guardRead` before provider; block returns `SafetyBlock` message.
- **Acceptance:** no sensitive content ever reaches Gemini/Groq from panel features; UI shows reason.
- **Chrome test:** open mock bank page; run *Summarise* → blocked; open news → allowed.
- **Unit tests:** classifier table; every read-path integration asserts guard called (mock safety-gate; expect invocation).
- **Result:** PS §6 read-scope enforced.

### Week 2 Exit Checklist

- PS §7 DoD items 8 (page-chat), 9 (context actions), 10 (screenshot Q&A).
- Provider reliability demonstrated (429, tier, Groq fallback, error UI).
- Sensitive-page reads blocked.

---

## 3. Week 3 — "The Hands": Act With User Approval

**Week goal:** interactive-element scanner, compact action map, *Find It for Me*, approval-based agent with full controls, and safety enforcement on action paths.
**Week exit gate:** PS §7 DoD items 11–14 pass.

### Phase 3.1 — Interactive Element Scanner (PS §2.12)

#### Slice 3.1.1 — Content script scan + stable numbering + refresh

- **Objective:** Detect supported action elements and assign stable per-page-state numbers.
- **Features:** buttons, links, text inputs, textareas, selects, checkboxes, other action elements.
- **Components:** `content/element-scanner.js`.
- **Files:** create; modify router to accept `scan-elements`.
- **Depends:** 1.1.4.
- **Steps:** walker enumerates supported selectors; each element gets a number keyed by a stable fingerprint (type + text + relative position); re-scan on DOM mutations refreshes map; **no key ever travels to content** (GDR-3).
- **Acceptance:** scan returns numbered list matching visible elements; numbers stable across minor changes; refreshes on navigation.
- **Chrome test:** open a form-heavy page; scan; verify numbering; edit page; re-scan; confirm map refreshed.
- **Unit tests:** fingerprint stability; ignored non-supported elements.
- **Result:** FR-7 groundwork.

#### Slice 3.1.2 — Numbered badges/overlays renderer

- **Objective:** Paint badges on-page so the user can identify elements.
- **Features:** overlay layer above page.
- **Components:** `content/badge-overlay.js`.
- **Files:** create; modify scanner to signal overlay.
- **Depends:** 3.1.1.
- **Steps:** content script draws small numbered pills anchored to element positions; hidden when panel toggles off; user page scripts cannot read overlay (isolated world).
- **Acceptance:** badges visible, aligned, togglable.
- **Chrome test:** enable scan; badges visible with correct numbers; disable; badges disappear.
- **Unit tests:** none visual; anchor calculation covered in scanner tests.
- **Result:** PS §2.12 UI surface.

### Phase 3.2 — Structured Action Map (PS §2.13)

#### Slice 3.2.1 — Compact action-map builder

- **Objective:** Convert scanned elements into a compact structure without raw HTML.
- **Features:** number, type, visible text, label, placeholder, relevant attributes.
- **Components:** `content/action-map-builder.js`, `shared/action-map-schema.js`.
- **Files:** create; modify router.
- **Depends:** 3.1.1, 3.1.2.
- **Steps:** builder returns only schema fields; oversized attributes truncated; refresh pipeline reuses scanner output; stored in `chrome.storage.session` keyed by tabId (Req 11).
- **Acceptance:** no raw HTML ever in the map; model input stays compact.
- **Chrome test:** run map; dump returned structure via devtools; confirm field whitelist.
- **Unit tests:** whitelist enforcement; size caps.
- **Result:** PS §2.13 satisfied.

### Phase 3.3 — Find It for Me (PS §2.14)

#### Slice 3.3.1 — NL query → JSON selection → highlight (never click)

- **Objective:** Let the user describe an element and highlight it.
- **Features:** strict JSON return, highlight-only.
- **Components:** `panel/features/find-it.js`.
- **Files:** create; modify panel UI to add query box.
- **Depends:** 3.2.1, 2.4.2.
- **Steps:** query + map sent to Gemini (lightweight); require strict JSON `{ elementNumber, reason }`; validate; content script highlights the element (uses overlay renderer, **not** executor); never auto-interact.
- **Acceptance:** highlight always matches a real element number; invalid JSON triggers a re-ask with a stronger tier; click path disabled.
- **Chrome test:** on application form ask "Where do I upload my resume?"; correct field highlighted.
- **Unit tests:** validator; refusal on non-existent number; assert "highlight only" path never invokes executor.
- **Result:** PS §2.14 satisfied.

### Phase 3.4 — Approval-Based Browser Agent (PS §2.15)

#### Slice 3.4.1 — Action envelope schema + validator

- **Objective:** Define and validate the structured `click | type | select | scroll | done` action contract.
- **Features:** pure validator.
- **Components:** `agent/action-envelope.js`, `agent/validator.js`.
- **Files:** create.
- **Depends:** 3.2.1.
- **Steps:** schema fields `{ type, target, value, reason }`; validator asserts allowed type, target exists in map, value present iff type ∈ {type, select}, `done` has no target; **deterministic pure module**, unit-testable.
- **Acceptance:** invalid envelopes never reach executor; validator is fast and side-effect-free.
- **Chrome test:** none (pure).
- **Unit tests:** each action type; malformed/missing/extra fields; `done` shape.
- **Result:** FR-7 groundwork.

#### Slice 3.4.2 — Next-action proposer (Gemini strict JSON)

- **Objective:** Ask Gemini for the single next action each loop step.
- **Features:** JSON-locked prompt, tiered model use.
- **Components:** `agent/next-action.js`.
- **Files:** create.
- **Depends:** 3.4.1, 2.4.2, 2.4.3.
- **Steps:** prompt supplies map + goal + task rules; response parsed and run through validator; on failure escalate tier once then controlled fail; no execution without validator pass.
- **Acceptance:** proposer never emits an action the validator rejects to executor.
- **Chrome test:** run on a practice form; observe JSON shape.
- **Unit tests:** prompt structure; failure-escalation path.
- **Result:** FR-7 grounded.

#### Slice 3.4.3 — State machine loop + review UI

- **Objective:** Implement the 10-step loop with a visible review panel (Arch §7).
- **Features:** read → map → propose → validate → safety-check → present → wait → execute → re-read → repeat.
- **Components:** `agent/orchestrator.js`, `panel/ui/review.js`.
- **Files:** create; modify panel layout to add Review section.
- **Depends:** 3.4.2, 1.2.2, 3.1.1.
- **Steps:** explicit states matching Arch §7.1 `stateDiagram`; each iteration stores current state in `chrome.storage.session` (Req 11); only one proposed action awaits approval at a time.
- **Acceptance:** the panel shows the proposed action + reason + target element highlighted; nothing executes without Approve.
- **Chrome test:** run a simple form task; verify one-step-at-a-time cadence.
- **Unit tests:** transition table; refusal when not in Reviewing; parallel proposals impossible.
- **Result:** FR-8 satisfied.

#### Slice 3.4.4 — Content-script action executor (approval-gated)

- **Objective:** Perform `click | type | select | scroll` **only** with a valid approval token.
- **Features:** isolated-world executor.
- **Components:** `content/action-executor.js`.
- **Files:** create; modify router to add `execute-approved`.
- **Depends:** 3.4.3, 1.2.2.
- **Steps:** router refuses `execute-approved` without an approval token issued by panel review; executor performs the single validated action; never receives a key (GDR-3).
- **Acceptance:** direct router calls without a token are rejected in tests and dev builds.
- **Chrome test:** attempt to invoke router executor without going through Approve → refused.
- **Unit tests:** token verification; type/scroll/select/click shapes; refusal paths.
- **Result:** PS §2.15 execution half; PS §6 "no autonomous actions" enforced.

#### Slice 3.4.5 — Session persistence across service-worker suspension

- **Objective:** Task progress and approval survive worker death (PS §4.1, §8).
- **Features:** `chrome.storage.session` durability.
- **Components:** modify `agent/orchestrator.js`, `state/session-store.js`.
- **Files:** edit.
- **Depends:** 3.4.3, 3.4.4.
- **Steps:** every state transition writes `{ step, actionLog, currentProposal, approvalState }` to `.session`; worker wake re-hydrates from `.session`; nothing agent-related is stored in the worker itself.
- **Acceptance:** force worker termination mid-task via devtools; panel resumes; state intact.
- **Chrome test:** start task; `chrome://extensions` → *Inspect views: service worker* → terminate; reopen panel; task still awaiting same proposal.
- **Unit tests:** hydrate/persist round-trip.
- **Result:** PS §8 session rule met (Req 11).

### Phase 3.5 — Agent Controls (PS §2.16)

#### Slice 3.5.1 — Approve / Skip / Stop / Dry Run / max-step

- **Objective:** Provide user controls over the loop.
- **Features:** PS §2.16 controls list.
- **Components:** `panel/ui/controls.js`.
- **Files:** create; modify Review UI.
- **Depends:** 3.4.3, 3.4.4.
- **Steps:** Approve → execute; Skip → re-plan; Stop → halt immediately (kills state machine, clears pending proposal); Dry Run → highlight only via overlay (never executor); configurable max-step counter aborts loop and reports.
- **Acceptance:** each button visibly changes state; Stop works mid-execute; Dry Run never invokes executor.
- **Chrome test:** run a task; press each control in turn; verify behaviour; exceed max steps → auto stop.
- **Unit tests:** control transition table; Dry Run routing assertion.
- **Result:** PS §2.16 controls half.

#### Slice 3.5.2 — Action log

- **Objective:** Persist proposed action, reason, user decision, outcome.
- **Features:** PS §2.16 log.
- **Components:** `agent/action-log.js`, `panel/ui/log-view.js`.
- **Files:** create; modify session store.
- **Depends:** 3.5.1, 3.4.5.
- **Steps:** each transition appends `{ proposal, reason, decision, result, timestamp }` to session log; UI renders scrollable view; export deferred to Week 4 skills/profile screens only if user requests.
- **Acceptance:** log shows all past proposals; survives worker restart via `.session`.
- **Chrome test:** perform 5 actions; log complete; terminate worker; log persists.
- **Unit tests:** append shape; log cap.
- **Result:** PS §2.16 log half; PS §7.14 satisfied.

### Phase 3.6 — Safety Enforcement on Action Paths (PS §2.20, Req 9)

#### Slice 3.6.1 — Action gate wired into orchestrator

- **Objective:** Extend the Week-1 safety module so every proposed action is gated before review.
- **Features:** blocked pages, blocked field types, consequential confirmations.
- **Components:** modify `safety/rules.js`, `safety/classifiers.js`; wire `guardAction` into `agent/orchestrator.js`.
- **Files:** edit those.
- **Depends:** 1.2.1, 3.4.3, 3.5.1.
- **Steps:** before entering Reviewing, `guardAction(envelope, map, pageClass)` runs — blocks on banking/payment hosts, blocks `type` on password/OTP/card fields, returns `require-confirm` for labels Submit/Pay/Send; only allowed actions can be shown.
- **Acceptance:** proposed dangerous action never reaches the Review UI.
- **Chrome test:** run a task on mock bank page; verify Stop/blocked message.
- **Unit tests:** every §2.20 rule; deterministic (same inputs → same decision); no AI in decision.
- **Result:** FR-10 satisfied on action side.

#### Slice 3.6.2 — Consequential confirmation + kill switch

- **Objective:** Extra confirm on Submit/Pay/Send; always-visible Stop.
- **Features:** PS §2.20, §4.3.
- **Components:** `panel/ui/confirm.js`, `panel/ui/kill-switch.js`.
- **Files:** create.
- **Depends:** 3.6.1.
- **Steps:** `require-confirm` opens explicit dialog before Approve is possible; Stop rendered persistently in panel header + toolbar menu item; Stop writes `aborted` to session immediately.
- **Acceptance:** Submit/Pay/Send cannot be one-click approved; Stop works in every state.
- **Chrome test:** propose Submit on a form → confirm dialog appears → confirm required; press Stop mid-flow → aborts.
- **Unit tests:** confirm gate refuses missing action; stop state transitions.
- **Result:** PS §4.3 satisfied.

### Phase 3.7 — Practice Tasks (PS §2.17)

#### Slice 3.7.1 — Practice environment + three errands

- **Objective:** Demonstrate the agent through controlled practice pages (internship application, shop search/filter, multi-page → table).
- **Features:** PS §2.17.
- **Components:** `practice/environments.js`, `practice/errands.js`.
- **Files:** create; modify panel UI to add *Practice* tab.
- **Depends:** 3.4.3, 3.6.2.
- **Steps:** load provided practice pages (user-owned/controlled — PS §2.20 restricts errands to these); each errand runs the same orchestrator loop with safety gate active; **every action requests approval** (PS §2.17 explicit).
- **Acceptance:** three errands complete with step-by-step approvals; no autonomous execution.
- **Chrome test:** complete each of the three errands in Chrome; log shows every proposal approved by user.
- **Unit tests:** errand definition shape; safety gate always invoked.
- **Result:** PS §7 DoD 12 satisfied.

### Week 3 Exit Checklist

- Find/highlight works (DoD 11).
- Practice tasks + approvals + skip/stop/dry-run + action log all pass (DoD 12–14).
- Safety blocks on protected pages/fields observable (seeded for DoD 17).

---

## 4. Week 4 — Memory, Safety, and Shipping

**Week goal:** local user profile, reusable prompt skills, full safety consolidation, distribution artefacts.
**Week exit gate:** PS §7 DoD items 15–18 pass.

### Phase 4.1 — Local User Profile (PS §2.18)

#### Slice 4.1.1 — Profile storage + UI

- **Objective:** Store name, college, skills, links, preferred language, preferred tone locally.
- **Features:** PS §2.18 fields.
- **Components:** `profile/profile-manager.js`, `panel/ui/profile.js`.
- **Files:** create; modify panel layout to add Profile tab.
- **Depends:** 1.1.3.
- **Steps:** define profile shape in `chrome.storage.local`; UI form for CRUD; local-only by default (PS §2.18); keys never mixed with profile content.
- **Acceptance:** profile round-trips; nothing auto-sent to AI until user requests.
- **Chrome test:** enter profile; reload; verify persistence.
- **Unit tests:** hydration, missing-field defaults, size caps.
- **Result:** FR-9 storage half.

#### Slice 4.1.2 — Reuse profile in forms/drafts (approval-gated)

- **Objective:** Let the assistant use profile info in supported form fills and drafts.
- **Features:** PS §2.18 reuse clause.
- **Components:** modify `agent/next-action.js`, `panel/prompts/draft.js`.
- **Files:** edit.
- **Depends:** 4.1.1, 3.4.3, 3.6.1.
- **Steps:** profile values inject as candidate `value` for `type` actions; every use still passes safety gate + explicit user approval; never auto-submit; profile fields marked private are only sent if user opts in (PS §2.18 last line).
- **Acceptance:** form-fill uses profile but still requires Approve per action.
- **Chrome test:** fill practice internship form using profile; every step awaits approval.
- **Unit tests:** injector respects privacy flags; never injects into password/OTP/card (asserts safety).
- **Result:** FR-9 satisfied.

### Phase 4.2 — Reusable Prompt Skills (PS §2.19)

#### Slice 4.2.1 — Skill manager + built-in recipes

- **Objective:** Create, save, reuse one-click prompt recipes (exam notes, Hinglish explain, polite email reply, form-fill using profile).
- **Features:** PS §2.19 recipes.
- **Components:** `skills/skill-manager.js`, `panel/ui/skills.js`.
- **Files:** create; modify panel layout to add Skills tab.
- **Depends:** 1.1.3, 1.7.1, 4.1.1.
- **Steps:** skill = `{ name, promptTemplate, language, usesProfile }`; stored in `chrome.storage.local`; UI lists skills + create/edit/delete; four built-ins shipped.
- **Acceptance:** skills reusable across chat, draft, summarise flows; correct prompt injection.
- **Chrome test:** create *Exam notes* skill; run on article; result matches template.
- **Unit tests:** template hydration; missing-profile guard.
- **Result:** PS §2.19 core.

#### Slice 4.2.2 — Import / Export skills via local file

- **Objective:** File-based portability.
- **Features:** PS §2.19 import/export.
- **Components:** `skills/io.js`.
- **Files:** create; add UI buttons.
- **Depends:** 4.2.1.
- **Steps:** Export writes JSON file locally; Import validates schema before write; **no keys** are ever included in exported file.
- **Acceptance:** round-trip export/import identical; malformed imports refused.
- **Chrome test:** export, edit file, import; verify list.
- **Unit tests:** schema validator; refuse on shape mismatch; assert no key fields present.
- **Result:** PS §2.19 portability satisfied; PS §7.16 satisfied.

### Phase 4.3 — Safety Consolidation (Req 9 completion)

#### Slice 4.3.1 — Full §2.20 rule set + coverage audit

- **Objective:** Ensure the pure safety module ships every §2.20 rule and that every read/action path passes through it.
- **Features:** §2.20 enumerated list.
- **Components:** modify `safety/*`, `panel/safety-gate.js`; add audit tests.
- **Files:** edit.
- **Depends:** 1.2.1, 1.2.2, 2.5.1, 3.6.1, 3.6.2.
- **Steps:** audit every read path (chat, translate, draft, screenshot, summarise) and every action path (execute-approved, dry-run) — all must call the gate; add integration tests that spy the gate and fail if any bypass; keys never committed (verified in CI/repo scan).
- **Acceptance:** 100% gate coverage on audited paths; deterministic outputs (no AI in decision); Stop reachable from every state.
- **Chrome test:** exercise every path; devtools assertion log confirms `guard` called.
- **Unit tests:** matrix of rules × paths.
- **Result:** FR-10 fully satisfied; PS §7.17 observable.

#### Slice 4.3.2 — Kill switch everywhere + persistent abort state

- **Objective:** Immediate stop reachable from any UI surface (PS §2.20).
- **Features:** Stop button always visible; abort persisted to session.
- **Components:** modify `panel/ui/kill-switch.js`.
- **Files:** edit.
- **Depends:** 3.6.2.
- **Steps:** Stop present in header of every panel view; abort writes to `.session`; on resume, orchestrator refuses to re-propose until user restarts.
- **Acceptance:** pressing Stop at any state halts the loop; reload does not resurrect.
- **Chrome test:** press Stop mid-flow; close/reopen panel; no pending proposal.
- **Unit tests:** abort write/read; resume refuses proposal.
- **Result:** PS §4.3 safety UX satisfied.

### Phase 4.4 — Distribution and Documentation (PS §2.21)

#### Slice 4.4.1 — Public GitHub repo + README + install/setup

- **Objective:** Publish repository with clean README and Chrome *Load unpacked* instructions.
- **Features:** PS §2.21 deliverables.
- **Components:** repo structure, `README.md`, `docs/install.md`, `docs/screenshot-guide.md`, `.gitignore` (keys never committed).
- **Files:** create/edit those.
- **Depends:** all prior slices.
- **Steps:** finalise folder layout; document the API-key limitation explicitly (PS §5 security note, Arch §9); add feature screenshots guide.
- **Acceptance:** new user can clone, follow README, load unpacked, enter their key (PS §7.1–7.4).
- **Chrome test:** fresh Chrome profile → follow README → working panel.
- **Unit tests:** none (docs).
- **Result:** PS §7.18 satisfied.

#### Slice 4.4.2 — Feature screenshots

- **Objective:** Demonstrate important features.
- **Features:** PS §2.21.
- **Components:** `docs/screens/*` captured images.
- **Files:** create.
- **Depends:** 4.4.1.
- **Steps:** capture summarise, page-chat, screenshot Q&A, find-it, agent review + approval, profile, skills.
- **Acceptance:** screenshots present in README.
- **Chrome test:** none.
- **Unit tests:** none.
- **Result:** PS §2.21 screenshots satisfied.

#### Slice 4.4.3 — GitHub Release ZIP

- **Objective:** Publish an installable ZIP under a tagged Release.
- **Features:** PS §2.21.
- **Components:** release pipeline (packaging step), `CHANGELOG.md`.
- **Files:** create.
- **Depends:** 4.4.1.
- **Steps:** package `manifest.json`, `panel/*`, `background/*`, `content/*`, `safety/*`, `providers/*`, `state/*`, `agent/*`, `vendor/Readability.js`, `icons/*`, `docs/*` into a ZIP; verify nothing key-bearing included; publish as GitHub Release.
- **Acceptance:** downloaded ZIP → *Load unpacked* works end-to-end (PS §7.1).
- **Chrome test:** download ZIP on a fresh profile; load; configure; run DoD checklist.
- **Unit tests:** none (packaging).
- **Result:** PS §7.1–7.2 satisfied.

#### Slice 4.4.4 — GitHub Pages one-page landing

- **Objective:** Publish a minimal landing page.
- **Features:** PS §2.21.
- **Components:** `docs/index.html` or `/landing` with Pages enabled.
- **Files:** create.
- **Depends:** 4.4.3.
- **Steps:** describe Sahayak; link to repo, release ZIP, and README.
- **Acceptance:** live URL visible; links correct.
- **Chrome test:** open URL.
- **Unit tests:** none.
- **Result:** PS §2.21 landing satisfied. Chrome Web Store **not** required (PS §6).

### Week 4 Exit Checklist

- PS §7 DoD items 15–18.
- Safety §2.20 rule set complete and integrated everywhere.
- Release ZIP installable.

---

## 5. Cross-Cutting Slicing Rules

| Rule | Enforcement |
|---|---|
| A slice is done only when it runs in Chrome and passes its acceptance criteria. | Week-exit checklists above (PS §8). |
| Slices are small. | No slice above spans multiple weeks or multiple unrelated modules. |
| Safety is consulted by every later slice. | GDR-5; verified by 4.3.1 audit tests. |
| API keys never leave the Side Panel. | GDR-3; router in 1.1.4 rejects payloads carrying `apiKey`. |
| No backend ever introduced. | GDR-2; manifest has no remote origins beyond Gemini/Groq HTTPS. |
| No autonomous action. | GDR-4; executor refuses without approval token (Slice 3.4.4). |

---

## 6. Final Project Testing & Release Checklist

Run this whole list in Chrome before tagging the GitHub Release (PS §2.21, §7).

### 6.1 Installation & First-Run
- [ ] Clone/download Release ZIP; extract.
- [ ] `chrome://extensions` → Developer mode → **Load unpacked** → icon appears.
- [ ] Open side panel; no manifest errors; service worker log shows registration.
- [ ] Settings: enter Gemini key; reload; masked value hydrates.
- [ ] No key present in any source file; `.gitignore` verified; repo history scanned.

### 6.2 Week 1 features
- [ ] Summarise a supported article → TL;DR + 5 points + next actions render.
- [ ] Summarise a supported public YouTube video → chapter-style notes with timestamps.
- [ ] Unsupported/private video → "cannot be summarised" message; no crash.
- [ ] Toggle English ↔ Hinglish → responses switch on next request.
- [ ] Optional Chrome built-in AI path: enabled → offline summary; disabled → falls through silently.

### 6.3 Week 2 features
- [ ] Page-chat answer grounded in current page; absent info → refusal message.
- [ ] Conversation history persists in-session; empty on browser restart.
- [ ] Streaming renders progressively when provider supports it.
- [ ] Right-click selection → *Explain* / *Translate* / *Draft reply (Email / LinkedIn / Forum)* all produce results.
- [ ] *Screenshot-and-Ask*: crop → Gemini vision answers about chart/error/form.
- [ ] Groq fallback serves text-only task when Gemini mocked unavailable; vision task refuses Groq.
- [ ] 429 injection → retries with backoff → final understandable error message.

### 6.4 Week 3 features
- [ ] Interactive scanner lists all supported elements with stable numbers; badges visible.
- [ ] Action map contains only whitelisted fields; no raw HTML.
- [ ] *Find It for Me* returns valid JSON; element highlighted; **no auto-click**.
- [ ] Agent loop proposes one action at a time; panel shows action + reason; nothing executes without Approve.
- [ ] Approve, Skip, Stop, Dry Run each behave correctly; max-step aborts runaway tasks.
- [ ] Action log records every proposal + decision + result.
- [ ] Terminate service worker mid-task → reopen panel → task resumes from `.session`.
- [ ] Practice errands (internship, shop search/filter, multi-page → table) complete only with user approvals.

### 6.5 Week 4 features
- [ ] Profile fields create/read/update locally; profile reused in form-fill and draft flows with per-action approvals.
- [ ] Skills: create, save, reuse; four built-in recipes run correctly.
- [ ] Export skills to a file; import back; malformed import rejected.
- [ ] Sensitive-page read gate blocks summarise/chat/draft on mock bank page.
- [ ] Executor refuses `type` on password/OTP/card inputs even when model proposed it.
- [ ] Conventional Submit/Pay/Send actions require extra confirmation.
- [ ] Stop/kill switch visible from every panel surface and works mid-flow.
- [ ] Safety module coverage audit test passes (every read/action path called the gate).

### 6.6 Distribution
- [ ] Public GitHub repository created with the extension folder.
- [ ] README clean and complete: overview, install, key-limitation note, screenshots.
- [ ] Screenshots added for major features.
- [ ] GitHub Release published with installable ZIP.
- [ ] Instructions for *Load unpacked* verified on a fresh Chrome profile.
- [ ] One-page GitHub Pages landing live and linked.
- [ ] Chrome Web Store publication explicitly **not** required (PS §6).

### 6.7 Non-Functional Spot Checks
- [ ] **Reliability:** invalid JSON never executed; retries bounded; suspension preserved.
- [ ] **Privacy:** keys never in source; profile stays local; only necessary page text sent.
- [ ] **Safety:** no action path executes without approval + safety gate pass.
- [ ] **Cost:** lightweight model used for routine tasks; stronger only where warranted.
- [ ] **Usability:** panel accessible via toolbar; errors readable; review controls obvious.

### 6.8 Definition-of-Done Sign-off (PS §7)
Confirm all 18 DoD items with a second tester using the Release ZIP + README, with no assistance.

---

## 7. Traceability Index

| Requirement | Delivered by slices |
|---|---|
| FR-1 Side Panel | 1.1.2 |
| FR-2 Settings & keys | 1.1.3 |
| FR-3 Extract readable content | 1.4.1 |
| FR-4 Article + YouTube summary | 1.5.1, 1.6.1 |
| FR-5 Page-grounded answers | 2.1.1–2.1.3 |
| FR-6 Screenshot understanding | 2.3.1–2.3.2 |
| FR-7 Structured + validated agent decisions | 3.4.1–3.4.3 |
| FR-8 Explicit approval before every action | 3.4.3–3.4.4, 3.5.1, 3.6.1–3.6.2 |
| FR-9 Local profile + skills | 4.1.1–4.2.2 |
| FR-10 Safety in code | 1.2.1–1.2.2, 2.5.1, 3.6.1–3.6.2, 4.3.1–4.3.2 |

---

*End of implementation plan. This file describes phases, slices, tests, and acceptance gates only; it contains no application code.*
