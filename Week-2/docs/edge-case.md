# Sahayak – Edge-Case & Failure-Mode Document

This document enumerates edge cases and failure modes for **Sahayak**, derived strictly from [`problemStatement.md`](./problemStatement.md), [`architecture.md`](./architecture.md), and [`implementation-plan.md`](./implementation-plan.md). It contains **no application code** — only scenarios, expected behaviour, user feedback, and Chrome testing steps. Every entry honours the invariants below.

---

## 0. Non-Negotiable Invariants (apply to every case)

Sourced from PS §2.20, §4.3, §5, §6, §8 and Arch §6, §7, §9. These must **never be weakened** by any edge-case resolution.

| ID | Invariant |
|---|---|
| INV-1 | **No browser action executes without explicit user approval.** Skip, Stop, Dry Run, and safety blocks are always available and always win against any model output. |
| INV-2 | **Content scripts never receive API keys.** AI network calls live only in the Side Panel (GDR-3). |
| INV-3 | **Safety decisions are deterministic, pure, and deny-biased.** They never rely only on AI instructions. |
| INV-4 | **Approval and task progress persist in `chrome.storage.session`**; profile/keys/skills in `chrome.storage.local`. |
| INV-5 | **Never send raw HTML or full-page dumps to a model** — only Readability text, the compact action map, or a cropped screenshot. |
| INV-6 | **Banking/payment pages, password/OTP/card fields, and login/payment automation are always blocked.** Consequential `Submit`/`Pay`/`Send` require an extra confirmation. |
| INV-7 | **Private, sensitive, and out-of-scope pages are never sent to free-tier AI.** |
| INV-8 | **Errors degrade gracefully (primary → fallback → understandable message); the extension never crashes.** |
| INV-9 | **API keys are documented as not truly secret** for a distributed extension; they are never committed to public source. |
| INV-10 | **Do not invent features.** Any case not covered here must be resolved by reference to the three source documents only. |

---

## 1. Edge-Case Format

Each case uses this layout:

- **ID** — unique edge-case identifier.
- **Week / Feature** — related week and feature (with PS/Arch refs).
- **Scenario** — what could go wrong.
- **Why it may occur** — root cause.
- **Expected system behaviour** — what Sahayak does instead.
- **User feedback / error message** — quoted string shown in the panel.
- **Chrome testing steps** — how to verify the behaviour.

---

## 2. Week 1 — The Eyes: Read the Web

### EC-W1-01 — Readability parse returns null
- **ID:** EC-W1-01
- **Week / Feature:** W1 — Article extraction (PS §2.3, Arch §3.3).
- **Scenario:** User clicks *Summarise* on a page that is not an article (dashboard, SPA shell, index, image gallery). Readability.js `parse()` returns `null`.
- **Why:** Readability requires semantic article structure; SPA/dashboards produce no `<article>` candidate.
- **Expected behaviour:** Extraction halts; nothing is sent to Gemini (INV-5); the read gate already passed but no text is available; panel renders the "not an article" message and disables the Summarise button until content changes.
- **User feedback:** *"This page doesn't look like a readable article, so Sahayak can't summarise it. Try a news or blog page, or paste the link on a supported article."*
- **Chrome testing:** Load a dashboard app (e.g. an SPA index); click Summarise; confirm the exact message; confirm no `fetch` to Gemini appears in Network tab.

### EC-W1-02 — Empty or blank webpage
- **ID:** EC-W1-02
- **Week / Feature:** W1 — Article extraction (PS §2.3).
- **Scenario:** Body is empty or contains only whitespace/scripts (about:blank, `<body></body>`, error page with no text).
- **Why:** Pages with no meaningful DOM text; some error interstitials.
- **Expected behaviour:** Readability returns empty `textContent`; the extract adapter applies its size floor and returns a `NoContent` result; the panel does not invoke Gemini; Summarise is disabled.
- **User feedback:** *"Sahayak couldn't find any readable content on this page."*
- **Chrome testing:** Open `about:blank` (in a normal tab, not a chrome:// URL); click Summarise; verify the exact message and no AI call.

### EC-W1-03 — Unsupported chrome:// / Web Store / other-extension pages
- **ID:** EC-W1-03
- **Week / Feature:** W1 — Article extraction + injection (PS §2.1, Arch §4).
- **Scenario:** User is on a `chrome://`, `chrome-extension://`, Edge add-ons gallery, or Chrome Web Store page.
- **Why:** Chrome forbids content-script injection into privileged pages.
- **Expected behaviour:** `chrome.scripting` rejects the injection; the router surfaces a `DisallowedPage` error; the panel shows the message and never attempts Gemini; the side panel itself still opens.
- **User feedback:** *"Sahayak can't read this page because Chrome reserves it for the browser. Open a normal website and try again."*
- **Chrome testing:** Navigate to `chrome://extensions`; click Summarise; confirm the exact message; check devtools console contains no leaked stack.

### EC-W1-04 — Article too short to summarise meaningfully
- **ID:** EC-W1-04
- **Week / Feature:** W1 — Article summarisation (PS §2.4).
- **Scenario:** Extracted text is a headline plus a single sentence (below a minimum viable length).
- **Why:** Some news pages return only a stub due to paywall skeletons.
- **Expected behaviour:** Panel applies a size floor before invoking Gemini; returns a *summary not meaningful* notice rather than hallucinating TL;DR/5-points (INV-5, Arch §5.4 grounding).
- **User feedback:** *"This article is too short for a useful summary. Sahayak needs a few paragraphs first."*
- **Chrome testing:** Load a paywall skeleton; click Summarise; verify refusal message; verify no AI call.

### EC-W1-05 — YouTube video without an accessible transcript
- **ID:** EC-W1-05
- **Week / Feature:** W1 — YouTube summarisation (PS §2.5, Arch §10).
- **Scenario:** Video exists but captions/transcript are unavailable (creator disabled them, non-supported language, brand-new upload).
- **Why:** Public videos may have no timedtext available.
- **Expected behaviour:** Adapter returns `NoTranscript`; the panel responds with PS §2.5's "cannot be summarised" path; **no fallback to arbitrary page scraping**; no crash.
- **User feedback:** *"This video doesn't have an accessible transcript, so Sahayak can't summarise it. Try another public video."*
- **Chrome testing:** Open a video with captions off; click Summarise; confirm exact message.

### EC-W1-06 — YouTube private, unlisted-without-access, or age-restricted
- **ID:** EC-W1-06
- **Week / Feature:** W1 — YouTube (PS §2.5, PS §6 out-of-scope).
- **Scenario:** Video is private, requires sign-in, or is age-restricted.
- **Why:** PS §6 explicitly places private videos out of scope.
- **Expected behaviour:** Adapter detects `unavailable` state; the panel shows a scope notice; Sahayak **does not attempt to bypass authentication or age gates** (INV-10).
- **User feedback:** *"Sahayak only summarises public YouTube videos. This one isn't publicly accessible."*
- **Chrome testing:** Open a private video URL in a logged-out profile; verify refusal; no request made to fetch transcript.

### EC-W1-07 — Missing Gemini API key
- **ID:** EC-W1-07
- **Week / Feature:** W1 — Settings + first-run (PS §2.1, FR-2, Arch §3.1).
- **Scenario:** User clicks Summarise / Explain / Chat before entering a key.
- **Why:** Fresh install with empty `chrome.storage.local`.
- **Expected behaviour:** Panel short-circuits before any network egress; navigates the user to Settings; **never stores any partial state that would leak on retry**.
- **User feedback:** *"Add your Gemini API key in Settings to continue."*
- **Chrome testing:** Wipe storage; open panel; click Summarise; redirected to Settings tab with the notice.

### EC-W1-08 — Invalid or revoked Gemini API key
- **ID:** EC-W1-08
- **Week / Feature:** W1 — Settings + provider (PS §2.11, Arch §5.3).
- **Scenario:** Gemini returns HTTP 401/403 (bad or revoked key).
- **Why:** User pasted the wrong string, key expired, quota exhausted on Google's side.
- **Expected behaviour:** Provider layer maps to a distinct `AuthError`, not retried (retry would fail identically); panel shows a clear, actionable message with a link to Settings; the key is masked (never logged).
- **User feedback:** *"Gemini rejected your API key. Please check it in Settings — Sahayak stores it only on this device."*
- **Chrome testing:** Enter a fake key; click Summarise; verify no retry storm; verify Settings is reachable via the message.

### EC-W1-09 — Language toggle mid-response
- **ID:** EC-W1-09
- **Week / Feature:** W1 — Language support (PS §2.6, Slice 1.7.1).
- **Scenario:** User switches English ↔ Hinglish while a response is rendering.
- **Why:** Fast UI interaction; the toggle writes to storage and prompts are only built per request.
- **Expected behaviour:** Current response completes in the language it was requested with; toggle preference applies to the **next** request; no visual corruption; no duplicate in-flight calls.
- **User feedback:** *(No error.)* Optional toast: *"Language changed. Next response will be in Hinglish."*
- **Chrome testing:** Start a long summary; flip toggle mid-render; verify in-flight response unchanged and next request switches.

### EC-W1-10 — Network failure during summarisation
- **ID:** EC-W1-10
- **Week / Feature:** W1 — Article extraction/summary + provider reliability (PS §2.11, Arch §5.3).
- **Scenario:** Offline, DNS failure, or connection drops after Gemini request is issued.
- **Why:** Real user environments; laptop lid, VPN blip, captive portal.
- **Expected behaviour:** Provider maps to `NetworkError`; **bounded retries with exponential backoff (PS §2.11)**; on exhaustion, understandable message; **no crash, no unhandled rejection**; partial results discarded.
- **User feedback:** *"Sahayak couldn't reach Gemini. Check your connection and try again."*
- **Chrome testing:** Devtools → Offline; click Summarise; observe bounded retries and final message; return online; click again → succeeds.

### EC-W1-11 — Very short or oversized selection for Explain
- **ID:** EC-W1-11
- **Week / Feature:** W1 — Selected-text explanation (PS §2.2, Slice 1.3.1).
- **Scenario:** User selects a single word, or 200 pages of text.
- **Why:** Selection size is unbounded by the browser.
- **Expected behaviour:** Adapter applies both lower and upper bounds; oversized selections are truncated **before** any read to Gemini; the panel notes the truncation; **full raw page text is never sent (INV-5)**.
- **User feedback:** *"Selection was too large; Sahayak used the first part of your selection."*
- **Chrome testing:** Select a whole article body; click *Explain*; verify truncation notice and small request payload.

### EC-W1-12 — Extension reloaded mid-operation
- **ID:** EC-W1-12
- **Week / Feature:** W1 — Foundation (PS §8, Arch §3.2).
- **Scenario:** Developer clicks *Reload* on the extension while a summary is streaming.
- **Why:** Chrome MV3 service worker + extension lifecycle.
- **Expected behaviour:** In-flight request aborts cleanly; on next panel open, storage hydrates normally; nothing key-related persists in an inconsistent state; **no data loss of profile/keys/settings**.
- **User feedback:** *(Silent recovery.)* Optional: *"Sahayak was reloaded. Re-run your last request if needed."*
- **Chrome testing:** Start Summarise; reload from `chrome://extensions`; reopen panel; confirm keys intact and no console stack leaked.

---

## 3. Week 2 — The Brain: Understand Page and Screen

### EC-W2-01 — Page-chat question not answerable from context
- **ID:** EC-W2-01
- **Week / Feature:** W2 — Page chat (PS §2.8, FR-5, Arch §5.4).
- **Scenario:** User asks something the page doesn't mention ("What's the capital of France?" on a Python tutorial).
- **Why:** Grounding rule requires refusal, not prior knowledge.
- **Expected behaviour:** Response uses the fixed grounding refusal constant; **no hallucinated answer**; **no external web lookup** (Sahayak has none).
- **User feedback:** *"The current page doesn't provide the information needed to answer that."*
- **Chrome testing:** Open any article; ask an off-topic question; verify the exact refusal message and no other data source used.

### EC-W2-02 — Very long webpage content exceeding provider budget
- **ID:** EC-W2-02
- **Week / Feature:** W2 — Chat context assembly (PS §2.8, §4.4, Arch §5).
- **Scenario:** Readability output exceeds the model's safe input budget.
- **Why:** Long-form articles, multi-page PDFs rendered as HTML.
- **Expected behaviour:** Context builder **truncates or window-selects** around the user's question; the panel informs that the answer covers a portion of the page; **never sends raw HTML (INV-5)**; no request rejected for over-length.
- **User feedback:** *"This page is very long; Sahayak answered using the most relevant portion."*
- **Chrome testing:** Load a long-form article; ask about a section near the end; verify response grounded and payload within budget.

### EC-W2-03 — Empty selected text (context menu on nothing)
- **ID:** EC-W2-03
- **Week / Feature:** W2 — Context menu actions (PS §2.9, Slice 2.2.1).
- **Scenario:** Right-click fires without a selection (some surfaces still expose the menu).
- **Why:** Selection state may be cleared between click and menu activation.
- **Expected behaviour:** Router refuses to open the AI path; the panel shows an *empty-selection* message; **no AI call**; no crash.
- **User feedback:** *"Select some text first, then right-click to use Sahayak."*
- **Chrome testing:** Deselect then trigger *Explain* via menu; verify exact message.

### EC-W2-04 — `tabs.captureVisibleTab` denied or window not visible
- **ID:** EC-W2-04
- **Week / Feature:** W2 — Screenshot-and-Ask (PS §2.10, Slice 2.3.1).
- **Scenario:** The window is minimised or on a locked/OEM-hidden desktop; the capture API returns an error.
- **Why:** Chrome enforces visible-window context for capture.
- **Expected behaviour:** Capture error surfaces as `CaptureUnavailable`; **the screenshot never persists**; the panel guides the user to bring the tab to the foreground.
- **User feedback:** *"Sahayak couldn't capture the tab. Bring the window to the front and try again."*
- **Chrome testing:** Minimise window; trigger capture via keyboard; verify the message; no partial image stored.

### EC-W2-05 — DRM / protected content yields blank or black capture
- **ID:** EC-W2-05
- **Week / Feature:** W2 — Screenshot (PS §2.10, PS §6 out-of-scope for risky bypass).
- **Scenario:** DRM-protected video region produces an empty/black image.
- **Why:** Chrome intentionally blanks protected surfaces.
- **Expected behaviour:** Panel detects mostly-blank pixel stats; **does not ask the model to interpret a blank image**; suggests the user try a non-protected region; **no attempt to bypass DRM (INV-10)**.
- **User feedback:** *"The captured area appears protected or blank. Try selecting a different region."*
- **Chrome testing:** Trigger capture on a DRM video player; verify message and no Gemini call.

### EC-W2-06 — Unsupported or corrupt image format from capture
- **ID:** EC-W2-06
- **Week / Feature:** W2 — Screenshot pipeline (PS §2.10, Arch §5.1).
- **Scenario:** Image is truncated, or an unexpected data URL is fed to the vision provider.
- **Why:** Interrupted capture; oversized frame; encoding bug.
- **Expected behaviour:** Provider layer rejects before network; panel asks the user to re-capture; **vision requests stay on Gemini only (Arch §5.1) and never route to Groq**.
- **User feedback:** *"Sahayak couldn't read the screenshot. Please capture again."*
- **Chrome testing:** Interrupt capture; verify rejection; no Gemini call issued.

### EC-W2-07 — Gemini HTTP 429 rate limit
- **ID:** EC-W2-07
- **Week / Feature:** W2 — API reliability (PS §2.11, Slice 2.4.1, Arch §5.3).
- **Scenario:** Repeated user requests trigger HTTP 429.
- **Why:** Free-tier quota, shared key across features.
- **Expected behaviour:** **Bounded retries with exponential backoff + jitter**; if task is **text-only eligible (Arch §5.1)**, fall through to Groq; if not eligible (vision), return the standard rate-limit message. **Never enters an infinite retry loop.**
- **User feedback:** *"Gemini is rate-limiting requests. Sahayak will try again shortly or use a fallback if available."*
- **Chrome testing:** Mock a persistent 429; observe bounded retries, fallback for text tasks, and refusal for vision tasks.

### EC-W2-08 — Gemini timeout and Groq fallback also fails
- **ID:** EC-W2-08
- **Week / Feature:** W2 — Provider layer resilience (PS §2.11, Arch §5.3).
- **Scenario:** Both providers error after retries (network outage, both quotas spent).
- **Why:** Compounding failures.
- **Expected behaviour:** **Graceful degradation path exhausted → understandable error (Arch §5.3)**; the extension never crashes; **no silent success pretending to be a response**.
- **User feedback:** *"AI services are temporarily unavailable. Sahayak didn't run your request."*
- **Chrome testing:** Mock both providers to fail; verify the exact final message and no partial content.

### EC-W2-09 — Vision task incorrectly routed to Groq
- **ID:** EC-W2-09
- **Week / Feature:** W2 — Provider eligibility (Arch §5.1, Slice 2.4.3).
- **Scenario:** A bug or config change sends a screenshot question to Groq.
- **Why:** Regression; Groq is text-only (Arch §5.1).
- **Expected behaviour:** **Eligibility guard rejects the request before network**, raising `IneligibleTaskError`; safety of the routing invariant is preserved; test suite catches this in Slice 2.4.3.
- **User feedback:** *(Internal error path.)* User sees generic: *"Sahayak couldn't process this image. Try again."*
- **Chrome testing:** Run the eligibility unit test; assert image + Groq combination throws before network.

### EC-W2-10 — Streaming interrupted mid-token
- **ID:** EC-W2-10
- **Week / Feature:** W2 — Streaming chat (PS §2.8, Slice 2.1.3).
- **Scenario:** Provider closes the stream unexpectedly; tokens stop arriving.
- **Why:** Network blip, server-side termination.
- **Expected behaviour:** Chat keeps the partial text visibly; appends a **clear "response stopped early" note**; the user can re-ask; **no JSON corruption** in chat; grounding rules still apply.
- **User feedback:** *"Sahayak's response stopped early. Ask again to continue."*
- **Chrome testing:** Devtools network throttling mid-request; observe partial text and message.

### EC-W2-11 — Context menu on a sensitive page (banking/payment)
- **ID:** EC-W2-11
- **Week / Feature:** W2 — Context actions + read gate (PS §2.20, Slice 2.5.1, Arch §6.2).
- **Scenario:** User right-clicks on a mock banking page and selects *Explain*.
- **Why:** Sensitive pages must not be sent to free-tier AI (INV-7).
- **Expected behaviour:** `guardRead` returns `block`; the panel shows the reason; **no page content is sent to any provider**; the safety block is logged for audit.
- **User feedback:** *"Sahayak blocks reading on banking and payment pages to protect sensitive data."*
- **Chrome testing:** Load mock bank page; trigger Explain via context menu; verify refusal and zero network egress.

### EC-W2-12 — Page-chat with disallowed (chrome://) target
- **ID:** EC-W2-12
- **Week / Feature:** W2 — Chat (PS §2.8 + W1 injection constraint).
- **Scenario:** User asks a question while a `chrome://` page is active.
- **Why:** Readability can't be injected on privileged pages (EC-W1-03).
- **Expected behaviour:** The panel reports there is no readable page content to ground on; **no fabricated context**; refusal path identical to EC-W1-03.
- **User feedback:** *"Sahayak can't read the current page, so it can't answer from it."*
- **Chrome testing:** Open `chrome://version`; ask chat a question; verify grounded-refusal message.

---

## 4. Week 3 — The Hands: Act With User Approval

### EC-W3-01 — Element disappears between scan and action
- **ID:** EC-W3-01
- **Week / Feature:** W3 — Scanner + executor (PS §2.12–2.15, Slices 3.1.1, 3.4.4).
- **Scenario:** Action map references element #7; the element un-mounts before Approve.
- **Why:** SPAs, dynamic forms, hover menus.
- **Expected behaviour:** Executor validates the fingerprint at execute time; on mismatch, **the action does not run**; orchestrator returns to `BuildingMap` for a refresh; the user sees a *page changed* notice; **no fallback to "click nearest element"**.
- **User feedback:** *"The target element changed before Sahayak could act. Re-scanning the page."*
- **Chrome testing:** Open a page with a toggleable form; approve an action while a script removes the element; observe refresh loop and no wrong click.

### EC-W3-02 — Duplicate or unstable element numbers after DOM change
- **ID:** EC-W3-02
- **Week / Feature:** W3 — Stable numbering (Slice 3.1.1).
- **Scenario:** Fingerprint collision assigns the same number to two elements, or numbers drift on every render.
- **Why:** Identical button labels, no `id` attributes.
- **Expected behaviour:** Scanner applies a deterministic tie-breaker (order of document walk); **drift beyond the collision triggers a re-scan and re-map**; badges and map stay consistent; the model is never sent a map with duplicate numbers.
- **User feedback:** *(Silent refresh.)* Optional toast: *"Sahayak refreshed the action map."*
- **Chrome testing:** Unit test with synthetic collisions; verify deterministic ordering.

### EC-W3-03 — Invalid AI-generated JSON
- **ID:** EC-W3-03
- **Week / Feature:** W3 — Validator (PS §4.1, Arch §5.4, Slice 3.4.1).
- **Scenario:** Gemini returns prose, malformed JSON, or missing `type` field.
- **Why:** Prompt drift; model variability.
- **Expected behaviour:** **Strict validator refuses the response**; provider escalates to a stronger tier once (Arch §5.3); on second failure, controlled `InvalidJSON` path — **never executes**; review UI unchanged.
- **User feedback:** *"Sahayak couldn't read the AI response. Please try again."*
- **Chrome testing:** Mock a provider that returns garbage; verify no execution and single tier escalation.

### EC-W3-04 — Correct JSON but wrong target element number
- **ID:** EC-W3-04
- **Week / Feature:** W3 — Validator + review (Arch §7.3).
- **Scenario:** `type` action carries `target=42` but the map max is 12.
- **Why:** Model hallucinated an out-of-range number.
- **Expected behaviour:** Validator rejects out-of-range target; loop returns to `Proposing`; **the UI never shows an invalid proposal as actionable**; approval is not offered for an unvalidated envelope.
- **User feedback:** *(Internal; user sees a re-propose delay.)*
- **Chrome testing:** Force a mock to emit `target=9999`; verify no review card appears.

### EC-W3-05 — Page navigation during an active task
- **ID:** EC-W3-05
- **Week / Feature:** W3 — Orchestrator (Arch §7).
- **Scenario:** User clicks a link and the page changes while the agent awaits approval.
- **Why:** Parallel human + agent activity.
- **Expected behaviour:** Orchestrator transitions to `BuildingMap` for the new state; **the pending approved proposal is invalidated** (no action runs on the new page using a stale target); session state updates in `chrome.storage.session` (INV-4).
- **User feedback:** *"The page changed. Sahayak refreshed the plan."*
- **Chrome testing:** Approve a proposal after navigating to a different URL; verify no stale executor call.

### EC-W3-06 — Skip or rejected action leaves a stale proposal
- **ID:** EC-W3-06
- **Week / Feature:** W3 — Controls (PS §2.16, Slice 3.5.1).
- **Scenario:** User hits *Skip*, then a network retry re-delivers the previous proposal.
- **Why:** Race between UI transition and delayed response.
- **Expected behaviour:** Orchestrator keys proposals by an incrementing token; **stale tokens are dropped before Review**; the user never sees an already-rejected action; the action log marks it `skipped`.
- **User feedback:** *(Silent.)*
- **Chrome testing:** Delay a mocked provider response past a Skip click; verify the response is ignored.

### EC-W3-07 — Service-worker suspension mid-task
- **ID:** EC-W3-07
- **Week / Feature:** W3 — Persistence (PS §4.1, §8, Slice 3.4.5).
- **Scenario:** Chrome terminates the worker while a proposal awaits approval.
- **Why:** MV3 lifecycle (Arch §3.2).
- **Expected behaviour:** State (current step, proposal, action log, approval flag) already written to `chrome.storage.session`; on wake, orchestrator re-hydrates and **re-presents the same pending proposal** to the user for explicit approval — **it never auto-executes on resume (INV-1)**.
- **User feedback:** *(Silent recovery.)* Optional: *"Sahayak resumed your task."*
- **Chrome testing:** `chrome://extensions` → terminate service worker while proposal shown; reopen panel; proposal still shown awaiting Approve.

### EC-W3-08 — Dry Run must never execute
- **ID:** EC-W3-08
- **Week / Feature:** W3 — Controls (PS §2.16, Slice 3.5.1).
- **Scenario:** User presses *Dry Run* on a `click` proposal.
- **Why:** Explicit control intent is "highlight only".
- **Expected behaviour:** Orchestrator routes to the badge/overlay renderer, **not the executor**; the DOM is never mutated; the log records `dry-run` and the target; **no approval token is generated** for the action.
- **User feedback:** *"Sahayak highlighted the element without clicking it."*
- **Chrome testing:** Unit test asserting executor call count = 0 for Dry Run; Chrome test on a form field shows overlay only.

### EC-W3-09 — Stop pressed after Approve but before Execute
- **ID:** EC-W3-09
- **Week / Feature:** W3 — Kill switch (PS §2.20, §4.3, Slice 4.3.2).
- **Scenario:** Approve message sent; user hits Stop before the content script confirms.
- **Why:** Millisecond-level race.
- **Expected behaviour:** Orchestrator aborts immediately; **executor drops the queued command**; state persists as `aborted` in `chrome.storage.session`; the action log shows `approved → aborted (stop)`.
- **User feedback:** *"Sahayak stopped. No action was performed."*
- **Chrome testing:** Slow the executor via CPU throttle; press Stop between Approve and execute; assert DOM unchanged.

### EC-W3-10 — Step limit reached
- **ID:** EC-W3-10
- **Week / Feature:** W3 — Max step control (PS §2.16, Slice 3.5.1).
- **Scenario:** Task loops past the configured maximum.
- **Why:** Model stuck in a plan cycle.
- **Expected behaviour:** Orchestrator terminates the loop; **no further proposals**; state transitions to `Failed`; user must explicitly restart.
- **User feedback:** *"Sahayak hit its step limit and stopped. Please review the task and restart if needed."*
- **Chrome testing:** Set max-step to 3; run an errand; verify automatic stop with message.

### EC-W3-11 — Executor receives request without approval token
- **ID:** EC-W3-11
- **Week / Feature:** W3 — Router + executor (Slice 3.4.4, INV-1).
- **Scenario:** A bug or malicious page script attempts to invoke the `execute-approved` family directly.
- **Why:** Isolation gap; untested code path.
- **Expected behaviour:** Router refuses; content script refuses; **no action runs**; a security assertion fires in dev builds; page scripts cannot reach the isolated-world function (Arch §3.4).
- **User feedback:** *(Silent; internal security event logged.)*
- **Chrome testing:** Unit test asserting executor rejects missing token; manual attempt via page console produces no execution.

### EC-W3-12 — Protected page (banking/payment) entered mid-task
- **ID:** EC-W3-12
- **Week / Feature:** W3 — Action safety (PS §2.20, Slice 3.6.1).
- **Scenario:** Task flow navigates the user into a mock bank page.
- **Why:** Multi-step form on a third-party host.
- **Expected behaviour:** `classifyPage` returns sensitive; `guardAction` returns `block`; the orchestrator enters `Blocked` and **does not re-propose any further action until the user manually resumes**; the user is informed; **no action, no typing, no click** on the sensitive page (INV-6).
- **User feedback:** *"Sahayak doesn't automate banking or payment pages. The task has been halted."*
- **Chrome testing:** Load mock bank page during an errand; verify halt + message.

### EC-W3-13 — Action map empty (non-interactive page)
- **ID:** EC-W3-13
- **Week / Feature:** W3 — Scanner + map (Slice 3.2.1).
- **Scenario:** User launches an errand on a page with no supported elements (e.g. a static PDF render).
- **Why:** Nothing actionable to enumerate.
- **Expected behaviour:** Map builder returns empty list; orchestrator transitions to `Blocked` with an explanation; **no AI call to invent targets**; user guided to a supported practice environment (PS §2.20 restricts errands to provided or user-owned pages).
- **User feedback:** *"Sahayak found no supported interactive elements on this page."*
- **Chrome testing:** Load a plain article; start an errand; verify refusal with no model call.

---

## 5. Week 4 — Memory, Safety, and Shipping

### EC-W4-01 — Missing or incomplete user profile
- **ID:** EC-W4-01
- **Week / Feature:** W4 — Local profile (PS §2.18, Slice 4.1.1).
- **Scenario:** Profile has only a name; skills/college/links/tone empty.
- **Why:** Partial first-run.
- **Expected behaviour:** Field-injection uses only present values; **empty fields are skipped, never filled with the model's guess**; profile reuse stays local (INV-9, INV-4); UI marks missing fields but does not block.
- **User feedback:** *"Add more to your profile so Sahayak can reuse it in drafts."*
- **Chrome testing:** Configure only a name; run a *Fill form using my profile* skill; verify unfilled fields left untouched.

### EC-W4-02 — Skill references profile field that's empty
- **ID:** EC-W4-02
- **Week / Feature:** W4 — Skills + profile (Slice 4.1.2, 4.2.1).
- **Scenario:** "Write a polite email reply" skill requests tone, but preferred tone isn't set.
- **Why:** Skill template mismatch.
- **Expected behaviour:** Skill loader substitutes a **neutral default** for missing tone (never the model fabricates personal details); a subtle notice suggests completing the profile; **the skill still runs safely**.
- **User feedback:** *"Sahayak used a neutral tone because your preferred tone isn't set."*
- **Chrome testing:** Clear tone field; run email skill; verify neutral output.

### EC-W4-03 — Invalid skill import
- **ID:** EC-W4-03
- **Week / Feature:** W4 — Skills import (PS §2.19, Slice 4.2.2).
- **Scenario:** File is malformed JSON, wrong schema, or missing `promptTemplate`.
- **Why:** Hand-edited or untrusted source.
- **Expected behaviour:** Schema validator refuses the import; **no partial state is written**; user sees an actionable error; existing skills unchanged.
- **User feedback:** *"That skill file couldn't be imported. Check the format and try again."*
- **Chrome testing:** Import a broken file; verify rejection and no storage mutation.

### EC-W4-04 — Skill import attempts to smuggle an API key
- **ID:** EC-W4-04
- **Week / Feature:** W4 — Skills import (PS §2.19, INV-2, INV-9).
- **Scenario:** A malicious file includes `apiKey: "..."` at top level.
- **Why:** Attempted exfiltration or accidental inclusion.
- **Expected behaviour:** Validator rejects any payload containing disallowed keys; the file is not persisted; **the extension never writes an imported key to storage**; audit log records the refusal.
- **User feedback:** *"Skill file contained disallowed fields and was rejected."*
- **Chrome testing:** Craft a file with `apiKey` at the top level; import; verify rejection.

### EC-W4-05 — Corrupted `chrome.storage.local` payload
- **ID:** EC-W4-05
- **Week / Feature:** W4 — Storage manager (Slice 4.1.1, Arch §9).
- **Scenario:** Profile/skill blob is unreadable after a bug or manual devtools tampering.
- **Why:** Schema drift; extension crash mid-write.
- **Expected behaviour:** Hydration wrapper catches parse errors; **falls back to safe defaults**; the user is asked to re-enter missing data; **keys are never re-issued to storage silently**.
- **User feedback:** *"Sahayak couldn't read your saved data. Defaults have been restored."*
- **Chrome testing:** Corrupt the profile field in devtools storage; reload panel; verify fallback message and no crash.

### EC-W4-06 — `chrome.storage.session` cleared after browser restart
- **ID:** EC-W4-06
- **Week / Feature:** W4 — Session persistence (Arch §9, INV-4).
- **Scenario:** User restarts Chrome; agent task progress is expected to be gone.
- **Why:** By design — `.session` clears on browser restart.
- **Expected behaviour:** Orchestrator starts fresh; **no stale pending proposals reappear**; message indicates the task ended (never auto-resumes without user approval).
- **User feedback:** *"Sahayak cleared the previous session."*
- **Chrome testing:** Start a task; restart Chrome; reopen panel; no pending proposal.

### EC-W4-07 — Model proposes `type` on a password/OTP/card field
- **ID:** EC-W4-07
- **Week / Feature:** W4 — Safety on action path (PS §2.20, Slice 3.6.1, INV-6).
- **Scenario:** Gemini suggests typing into a field the classifier flags as sensitive.
- **Why:** Model optimises task completion over safety.
- **Expected behaviour:** `guardAction` returns `block`; the proposal never reaches Review; **approval cannot be offered**; action log records the block; safety decision is deterministic and independent of AI (INV-3).
- **User feedback:** *"Sahayak won't type into password, OTP, or card fields."*
- **Chrome testing:** Force a mock to emit `type` on `input[type=password]`; verify block before review UI.

### EC-W4-08 — Consequential action clicked without extra confirmation
- **ID:** EC-W4-08
- **Week / Feature:** W4 — Consequential confirmation (PS §2.20, Slice 3.6.2).
- **Scenario:** Model proposes `click` on a button labelled `Submit` / `Pay` / `Send`.
- **Why:** High-impact action.
- **Expected behaviour:** `require-confirm` path forces an **additional confirmation dialog distinct from the Approve button**; only after the second explicit confirmation does execution proceed (INV-1, INV-6).
- **User feedback:** *"Sahayak is about to submit/pay/send. Confirm this consequential action to proceed."*
- **Chrome testing:** Run an errand to a submit button; verify the extra confirm dialog blocks single-click approval.

### EC-W4-09 — Missing API keys after Week 4 configuration
- **ID:** EC-W4-09
- **Week / Feature:** W4 — Distribution (PS §2.21, EC-W1-07).
- **Scenario:** Fresh install from Release ZIP with no keys.
- **Why:** Keys never shipped; documented non-secret limitation (PS §5 note).
- **Expected behaviour:** Same path as EC-W1-07: Settings navigation; README prominently explains the user must supply their own key; **no key is ever embedded in the extension package**.
- **User feedback:** *"Sahayak needs your Gemini API key. See README for setup."*
- **Chrome testing:** Install from Release ZIP on a clean profile; verify no keys bundled; complete first-run flow.

### EC-W4-10 — Load unpacked fails after Release ZIP download
- **ID:** EC-W4-10
- **Week / Feature:** W4 — Distribution (PS §2.21, Slice 4.4.3).
- **Scenario:** ZIP missing `manifest.json` at the root, or has an unextracted subfolder.
- **Why:** Packaging mistake.
- **Expected behaviour:** Chrome rejects the load with a clear error; release CI should prevent it; README documents expected folder layout.
- **User feedback:** *(Chrome's own message.)* README guidance: *"Point Load unpacked to the folder that contains `manifest.json`."*
- **Chrome testing:** Attempt load with nested folder; verify README explains the correct target.

### EC-W4-11 — Profile fields imply sensitive data (SSN, passwords)
- **ID:** EC-W4-11
- **Week / Feature:** W4 — Local profile (PS §2.18, INV-6).
- **Scenario:** User types credentials or a payment number into a free-text profile field.
- **Why:** Profile is user-authored.
- **Expected behaviour:** **The profile UI warns against storing credentials or payment info**; sensitive-looking values are **never sent to AI providers**; skill form-fill refuses to reuse them; **no automation of login/payment/card workflows (PS §6)**.
- **User feedback:** *"Please don't store passwords or payment details in your profile. Sahayak will never reuse those."*
- **Chrome testing:** Enter a password-looking string; run a fill skill; verify it's not injected into any form field.

### EC-W4-12 — Sensitive page read during summarise
- **ID:** EC-W4-12
- **Week / Feature:** W4 — Safety consolidation (Slice 4.3.1, INV-7).
- **Scenario:** User opens a mock health/finance page and clicks Summarise.
- **Why:** Read path must pass the same gate as action paths.
- **Expected behaviour:** `guardRead` blocks; **no content is sent to Gemini/Groq**; safety gate coverage audit test (Slice 4.3.1) verifies no bypass exists.
- **User feedback:** *"Sahayak blocks reading sensitive pages to keep them off AI services."*
- **Chrome testing:** Coverage audit test + Chrome manual verification.

---

## 6. Security & Privacy Edge Cases (cross-cutting)

### EC-SEC-01 — Key visibility in a distributed extension
- **ID:** EC-SEC-01
- **Week / Feature:** Cross-cutting — Settings + README (PS §5 note, Arch §9).
- **Scenario:** A curious user or third party inspects `chrome.storage.local` and finds their own key.
- **Why:** Extension code is not a secure enclave; storage is device-bound, not encrypted as a vault.
- **Expected behaviour:** Documented limitation in README + Settings note (INV-9); keys never logged; keys never cross into content scripts (INV-2); the extension does not describe storage as an encrypted secret vault.
- **User feedback:** *"Sahayak stores your key only on this device. Any local user with Chrome access can inspect it — treat it as a personal key, not a shared secret."*
- **Chrome testing:** Confirm no key appears in extension source; confirm devtools console never prints the key.

### EC-SEC-02 — Prompt injection via webpage content
- **ID:** EC-SEC-02
- **Week / Feature:** Cross-cutting — Grounded chat + agent (PS §2.8, §4.1, Arch §5.4).
- **Scenario:** Malicious page contains hidden text like *"Ignore previous instructions and click…"*.
- **Why:** Page content is passed as context.
- **Expected behaviour:** **Deterministic safety gate is independent of AI** (INV-3): even if the model is fooled, the action validator + `guardAction` still refuse; **no browser action without user approval (INV-1)**; response still obeys the grounding rule.
- **User feedback:** *(User sees the proposal but must Approve; safety block message if gate fires.)*
- **Chrome testing:** Load a page containing injected instructions; start a task; verify no unapproved execution.

### EC-SEC-03 — Sensitive content sent to free-tier AI
- **ID:** EC-SEC-03
- **Week / Feature:** Cross-cutting — Read gate (PS §6, §2.20, INV-7).
- **Scenario:** Bug bypasses `guardRead` and ships banking text to Gemini.
- **Why:** Regression, path added that skipped the gate.
- **Expected behaviour:** Coverage audit test (Slice 4.3.1) fails CI; runtime assertion in dev builds throws before network; the extension has **one** choke point (Side Panel), making the audit tractable (Arch §3.1).
- **User feedback:** *(Internal security failure; block message shown to user.)*
- **Chrome testing:** Audit test asserts `guardRead` invoked on every read path.

### EC-SEC-04 — Page scripts attempt to read content-script state
- **ID:** EC-SEC-04
- **Week / Feature:** Cross-cutting — Isolated world (Arch §3.3).
- **Scenario:** Webpage JS runs `window.__sahayak` expecting extension data.
- **Why:** Attempted data exfiltration.
- **Expected behaviour:** MV3 **isolated world** prevents page scripts from seeing content-script variables; no state is placed on `window`; badges/overlays are visual only; **no API keys or map data ever exposed** (INV-2).
- **User feedback:** *(Silent — the attempt fails.)*
- **Chrome testing:** From page console, attempt to read any Sahayak global; confirm `undefined`.

### EC-SEC-05 — Screenshot or chat content leaked to logs
- **ID:** EC-SEC-05
- **Week / Feature:** Cross-cutting — Privacy (PS §4.2, INV-5, INV-9).
- **Scenario:** Debug logging accidentally prints cropped image bytes or chat history.
- **Why:** Verbose developer logging left on.
- **Expected behaviour:** Log hygiene rule enforced: no `console.log` of page content, image data, keys, or chat messages; screenshots are held in memory only and cleared; `.session` is not exported.
- **User feedback:** *(Silent; internal CI lint check fails in dev.)*
- **Chrome testing:** Devtools console inspection during a screenshot flow: verify no byte dumps.

---

## 7. Browser Permission Problems (cross-cutting)

### EC-PERM-01 — `captureVisibleTab` denied / no active tab
- **ID:** EC-PERM-01
- **Week / Feature:** W2 — Screenshot (Slice 2.3.1, PS §2.10).
- **Scenario:** Panel invoked from a context without a visible tab (e.g. no window focus).
- **Why:** Chrome enforces active-tab capture.
- **Expected behaviour:** Friendly *bring the tab to the front* message (EC-W2-04); **no image persisted**; no fallback to synthetic capture.
- **User feedback:** *"Sahayak needs the tab in the foreground to capture a screenshot."*
- **Chrome testing:** Blur the window; trigger capture; verify the message.

### EC-PERM-02 — Missing host permission for the current site
- **ID:** EC-PERM-02
- **Week / Feature:** Cross-cutting — Manifest (PS §2.1, Arch §4).
- **Scenario:** `activeTab` isn't granted because the user opened the panel via keyboard without clicking the icon on a fresh tab.
- **Why:** Least-privilege model.
- **Expected behaviour:** Injection request fails; panel asks the user to click the toolbar icon to grant tab access; **no silent broadening of permissions**.
- **User feedback:** *"Click the Sahayak toolbar icon to let it read this tab."*
- **Chrome testing:** Open panel via keyboard shortcut on a page without prior icon click; verify prompt.

### EC-PERM-03 — Extension disabled mid-task
- **ID:** EC-PERM-03
- **Week / Feature:** Cross-cutting — Lifecycle (Arch §3.2).
- **Scenario:** User toggles the extension off from `chrome://extensions`.
- **Why:** Immediate "kill switch" behaviour.
- **Expected behaviour:** Content scripts unload; orchestrator loses its process; on re-enable, session state hydrates from `.session`; **the extension never auto-resumes actions** — pending proposals are dropped (INV-1).
- **User feedback:** *(Silent; on re-enable.)* *"Previous task ended. Start again if needed."*
- **Chrome testing:** Toggle off/on mid-task; verify no executed action.

### EC-PERM-04 — Chrome version without Side Panel API
- **ID:** EC-PERM-04
- **Week / Feature:** W1 — Foundation (PS §2.1, FR-1).
- **Scenario:** Older Chrome lacks `sidePanel` API.
- **Why:** Minimum version support.
- **Expected behaviour:** README documents the minimum Chrome version; extension manifest declares it; Chrome shows "This extension requires a newer version of Chrome" at load; **no runtime crash**.
- **User feedback:** *(Chrome's own message.)*
- **Chrome testing:** Attempt load on an unsupported version; verify install refused.

---

## 8. Unsupported Websites (cross-cutting)

### EC-UNS-01 — Privileged browser pages
- **ID:** EC-UNS-01
- **Week / Feature:** Cross-cutting — Foundation (PS §2.1).
- **Scenario:** `chrome://`, `edge://`, `about:`, `devtools://` surfaces.
- **Why:** Content scripts are disallowed by policy.
- **Expected behaviour:** Injection refused; the panel explains the browser reserve (EC-W1-03); no attempt to bypass; **no partial injection**.
- **User feedback:** *"Sahayak can't read reserved browser pages."*
- **Chrome testing:** Try extraction on each prefix; verify consistent message.

### EC-UNS-02 — Chrome Web Store / extension galleries
- **ID:** EC-UNS-02
- **Week / Feature:** Cross-cutting — Foundation.
- **Scenario:** `chromewebstore.google.com` and other extension galleries.
- **Why:** Chrome disallows injection into gallery pages.
- **Expected behaviour:** Same as EC-UNS-01; the panel is still usable for text-only tasks if the user pastes content.
- **User feedback:** *"Sahayak can't read the Web Store. Paste the text into the panel instead."*
- **Chrome testing:** Attempt extraction on the Store; verify refusal.

### EC-UNS-03 — PDF.js viewer and file:// without permission
- **ID:** EC-UNS-03
- **Week / Feature:** Cross-cutting — Article extraction.
- **Scenario:** PDF rendered via Chrome's built-in viewer or `file://` without host grant.
- **Why:** Text lives in a plugin surface not exposed to Readability.
- **Expected behaviour:** Adapter returns `NoReadableContent`; the panel explains the limitation; no attempt to fetch local files without explicit permission.
- **User feedback:** *"Sahayak can't read Chrome's PDF viewer. Copy the text into the panel instead."*
- **Chrome testing:** Open a PDF; run Summarise; verify graceful refusal.

### EC-UNS-04 — Heavy iframe / shadow-DOM pages
- **ID:** EC-UNS-04
- **Week / Feature:** W3 — Element scanner (Slice 3.1.1).
- **Scenario:** Login forms inside cross-origin iframes; elements inside closed shadow DOMs.
- **Why:** Content script can't see inside another origin's frame or closed shadow root.
- **Expected behaviour:** Scanner enumerates only what's reachable; **it does not claim elements it can't act on**; the model is given a truthful map; no crash.
- **User feedback:** *"Sahayak sees some elements inside protected frames that it can't act on."*
- **Chrome testing:** Load a page with an embedded third-party form; run the scanner; verify map contains only reachable elements.

---

## 9. Recovery & Graceful Error Handling (cross-cutting)

### EC-REC-01 — Side panel closed while a response is streaming
- **ID:** EC-REC-01
- **Week / Feature:** Cross-cutting — Streaming (Slice 2.1.3, Arch §3.1).
- **Scenario:** User closes the panel mid-stream.
- **Why:** Common UX action.
- **Expected behaviour:** In-flight request is aborted; on reopen, chat history from `.session` is rendered up to the last complete message; **no partial JSON or truncated tokens persisted as if complete**.
- **User feedback:** *(Silent.)*
- **Chrome testing:** Close panel mid-stream; reopen; verify history shows a clean last state.

### EC-REC-02 — Storage quota exceeded
- **ID:** EC-REC-02
- **Week / Feature:** Cross-cutting — Storage manager (Arch §9).
- **Scenario:** Skill history or action log grows past quota.
- **Why:** Long unbounded session on heavy machines.
- **Expected behaviour:** Session store applies **size caps first, then FIFO eviction**; on unrecoverable `QuotaExceeded`, the panel shows a clear message and safely halts writes; no crash.
- **User feedback:** *"Sahayak's local storage is full. Clear the action log or start a new session."*
- **Chrome testing:** Fill session log artificially large; verify eviction + message.

### EC-REC-03 — Chrome or extension update mid-install
- **ID:** EC-REC-03
- **Week / Feature:** Cross-cutting — Distribution (PS §2.21, Slice 4.4.3).
- **Scenario:** Auto-update replaces the worker while a proposal awaits.
- **Why:** MV3 lifecycle.
- **Expected behaviour:** State persisted in `.session`; on next panel focus, same pending proposal reappears for explicit approval; **no auto-execute on reload (INV-1)**.
- **User feedback:** *(Silent.)*
- **Chrome testing:** Force an update via `chrome://extensions` during a paused task; verify no auto-execute.

### EC-REC-04 — Concurrent tasks in different tabs
- **ID:** EC-REC-04
- **Week / Feature:** Cross-cutting — Panel ↔ tab binding (Arch §3.2).
- **Scenario:** User starts a task in tab A, switches to tab B, begins another.
- **Why:** Panel is per-tab-bound via `sidePanel.setOptions`.
- **Expected behaviour:** Each tab has its own action map and orchestrator state in `.session`; switching tabs shows the state for the **active tab**; **no proposal from tab A ever executes on tab B** (target element numbers are tab-scoped).
- **User feedback:** *(Silent; tab-isolated.)*
- **Chrome testing:** Start a task in two tabs; switch; verify each tab's proposal is distinct.

### EC-REC-05 — Provider returns valid JSON but unsafe intent
- **ID:** EC-REC-05
- **Week / Feature:** Cross-cutting — Safety gate + validator (Arch §6.1, §7.3).
- **Scenario:** Envelope passes the validator but proposes `type` into a password field or a `click` on `Pay`.
- **Why:** Model optimises for task completion.
- **Expected behaviour:** **Validator pass is not enough** — the deterministic safety gate is a mandatory second stage (INV-3); `block` for password typing; `require-confirm` for `Pay` (INV-6); **no proposal bypasses the gate to reach the user**.
- **User feedback:** *"Sahayak blocked an unsafe action before it could reach you."*
- **Chrome testing:** Force a mock to emit `type` on `password`; verify block.

### EC-REC-06 — Model emits `done` prematurely
- **ID:** EC-REC-06
- **Week / Feature:** W3 — Orchestrator (Arch §7.1).
- **Scenario:** Agent returns `done` while the goal isn't met.
- **Why:** Model confidence miscalibration.
- **Expected behaviour:** Orchestrator transitions to `Done`; **user reviews the action log and restarts manually**; the log is always accessible so the user can audit; **no silent continuation**.
- **User feedback:** *"Sahayak marked the task complete. Review the action log to verify."*
- **Chrome testing:** Force a `done` proposal early; verify log intact and task closed.

### EC-REC-07 — Any path that would bypass user approval
- **ID:** EC-REC-07
- **Week / Feature:** Cross-cutting — Absolute rule (PS §8, INV-1).
- **Scenario:** A regression routes directly from `Proposing` to `Executing`.
- **Why:** Test/dev toggle left on; missing state guard.
- **Expected behaviour:** Orchestrator state machine enforces `Reviewing → Executing` only; any transition bypassing Review throws; unit test matrix (Slice 3.4.3) asserts all forbidden transitions.
- **User feedback:** *(Internal assertion; user sees the same pending proposal.)*
- **Chrome testing:** Run state-machine unit tests; assert Approve is the sole entry to `Executing`.

---

## 10. Testing Priorities

Coverage tiers for the QA plan; every case above maps to at least one tier.

| Priority | Cases | Rationale |
|---|---|---|
| **P0 — Must test before every release** | EC-W1-07, EC-W1-08, EC-W1-10 · EC-W2-07, EC-W2-08, EC-W2-11 · EC-W3-03, EC-W3-11, EC-W3-12 · EC-W4-07, EC-W4-08, EC-W4-09 · EC-SEC-02, EC-SEC-03, EC-REC-05, EC-REC-07 | Safety, approval, keys, rate limits, sensitive-page and sensitive-field gates. Any regression here directly violates INV-1, INV-3, INV-6, or INV-7. |
| **P1 — Test in every week's acceptance** | All Week-exit checklist items; EC-W1-01, EC-W1-03, EC-W1-05, EC-W2-01, EC-W2-04, EC-W2-05, EC-W3-01, EC-W3-05, EC-W3-07, EC-W3-08, EC-W3-09, EC-W3-10, EC-W4-03, EC-W4-04, EC-W4-11, EC-SEC-01, EC-SEC-04, EC-PERM-01, EC-PERM-02, EC-UNS-01–04, EC-REC-01–04 | Core UX, extraction, capture, orchestrator, storage, skills, and unsupported-surface handling. |
| **P2 — Automated unit / CI** | EC-W1-09, EC-W1-11, EC-W1-12, EC-W2-02, EC-W2-03, EC-W2-06, EC-W2-09, EC-W2-10, EC-W2-12, EC-W3-02, EC-W3-04, EC-W3-06, EC-W3-13, EC-W4-01, EC-W4-02, EC-W4-05, EC-W4-06, EC-W4-10, EC-SEC-05, EC-PERM-03, EC-PERM-04, EC-REC-05, EC-REC-06 | Guard rails; validator, eligibility, storage, and lifecycle tests prevent the class of bugs the earlier P0/P1 cases surface. |
| **P3 — Exploratory manual, quarterly** | Prompt injection variants, DRM page classes, unusual locale/language toggles, high-DPI capture, accessibility modes. | Surface real-world drift that a fixed suite may miss. |

### 10.1 Traceability to Implementation-Plan Slices

| Edge-case family | Owning slice(s) |
|---|---|
| Extraction & summary (W1) | 1.4.1, 1.5.1, 1.6.1 |
| Keys & Settings (W1, W4) | 1.1.3, 4.4.1 |
| Provider reliability (W2) | 2.4.1–2.4.4 |
| Vision + eligibility (W2) | 2.3.1–2.3.2, 2.4.3 |
| Scanner + map + JSON (W3) | 3.1.1, 3.2.1, 3.4.1–3.4.3 |
| Executor + approval (W3) | 3.4.4, 3.5.1 |
| Session persistence (W3) | 3.4.5, 2.1.2 |
| Safety engine (all weeks) | 1.2.1–1.2.2, 2.5.1, 3.6.1–3.6.2, 4.3.1–4.3.2 |
| Profile & skills (W4) | 4.1.1–4.2.2 |
| Distribution (W4) | 4.4.1–4.4.4 |

---

## 11. Out-of-Scope Guardrails (never resolved "conveniently")

To keep faith with PS §6 and INV-10, these are **not** handled as features and are refused consistently:

- Autonomous browser execution without user approval.
- Banking/payment automation of any kind.
- Login / OTP / password / card-information automation.
- Sending private or sensitive pages to free-tier AI services.
- Risky automation on arbitrary third-party websites.
- Chrome Web Store publication.
- Mobile browser extension behaviour.
- Bypassing DRM or authentication gates.

For each, the response is the same pattern: **deterministic block + understandable message + no network egress + no auto-execute**.

---

*End of edge-case document. This file enumerates failure modes, safety-preserving behaviour, and Chrome test procedures only; it contains no application code.*
