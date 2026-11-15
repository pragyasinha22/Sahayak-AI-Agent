node --check panel\features\chat.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --check panel\prompts\page-chat.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --check tests\unit\page-chat.test.js

Get-ChildItem "C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent" -Recurse -File -Filter "*chat*.js" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName

node tests\unit\page-chat.test.js

Select-String -Path panel\side-panel.html -Pattern "chat-form|chat-input|page-chat.js|features/chat.js"

node --check panel\features\chat.js; node --check panel\prompts\page-chat.js; node tests\unit\page-chat.test.js

PS C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent\Week-2> node --check panel\features\chat.js

PS C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent\Week-2> node tests\unit\page-chat.test.js
# page-chat prompt
  ✓ exports the exact fixed refusal sentence
  ✓ prompt includes supplied page context
  ✓ prompt includes the user question
  ✓ prompt includes the selected English language instruction
  ✓ prompt includes the selected Hinglish language instruction
  ✓ prompt explicitly enforces page-only grounding and ignores webpage instructions
  ✓ missing or empty page context produces no answer prompt

# runChat safety and extraction orchestration
  ✓ blocked page stops before injection, extraction, key retrieval, and provider call
  ✓ blocked page renders the exact unsupported-page message
  ✓ failed extraction does not retrieve the key or call the provider
  ✓ insufficient extraction does not retrieve the key or call the provider
  ✓ allowed page is gated before Readability injection using the shared file list
  ✓ allowed page uses guardedSend with the extract-article family
  ✓ provider receives the question and extracted text via explainSelection-compatible options
  ✓ successful answer preserves the extraction truncated flag

15 passed, 0 failed
PS C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent\Week-2> 
=================================================

What is this page about?

What is the author's home address?

Is page ka main topic kya hai?

------------------PROMPT----------------------------------------------------------
# Sahayak — Implement Week 2, Slice 2.2.1: Context Menus

You are working on my existing Sahayak Chrome Extension project.

**Project root:**
`C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent`

**Active implementation folder:**
`Week-2`

## 1. Critical preservation rules — READ FIRST

This is an incremental implementation task.

Existing functionality must remain intact. Do not rewrite, remove, simplify, rename, or break any existing working feature.

The following are completed and must be preserved:

- Week 1: All existing functionality, including settings, API key storage, safety module, language preferences, router, Explain, and existing UI.
- Week 2 — 2.1.1: Page-grounded chat.
- Week 2 — 2.1.2: Conversation history using `chrome.storage.session`.
- Week 2 — 2.1.3: Gemini streaming responses, including progressive rendering in the side panel.

**Strict rules:**

1. Never modify `Week-1`.
2. Never edit duplicate files in the project root.
3. Work only inside `Week-2`.
4. Do not replace entire existing files when a small additive change is sufficient.
5. Do not remove or alter existing functions, exports, event listeners, message types, storage logic, or UI behavior unless absolutely required and explicitly justified.
6. Do not change the Gemini model, streaming implementation, retry behavior, or Page Chat prompt.
7. Do not introduce a backend.
8. Do not expose API keys to content scripts.
9. Do not add unrelated features from Slice 2.2.2 or later slices.
10. Inspect the actual existing code before deciding where to implement anything.

## 2. First inspect the existing architecture

Read these project files before making changes:

- `Week-2/manifest.json`
- `Week-2/background/service-worker.js`
- `Week-2/panel/features/chat.js`
- `Week-2/panel/index.html` (or the actual side-panel HTML file)
- Existing message/router modules.
- Existing context-menu implementation, if any.
- Relevant tests.
- `docs/problemStatement.md`
- `docs/architecture.md`
- `docs/implementation-plan.md`
- `docs/edge-case.md` (if available in the active project).

Identify:
- Existing runtime message types and routing conventions.
- How the side panel is opened.
- How selected text is passed from the background worker to the panel.
- How Page Chat stores messages and identifies the active tab.
- Existing manifest permissions and service-worker imports.

Do not assume file paths, IDs, or message types without checking.

## 3. Implement ONLY Slice 2.2.1

Add professional, reliable Chrome context-menu functionality for three actions:

1. Explain
2. Translate
3. Draft reply

When the user selects text on a normal webpage and right-clicks, the Sahayak context menu should provide these three options.

Expected flow:

1. User selects text on a webpage.
2. User right-clicks the selection.
3. User chooses Explain, Translate, or Draft reply.
4. The extension opens the Sahayak side panel for the originating tab.
5. The selected text and chosen action are passed safely through the existing background-to-panel messaging architecture.
6. The panel receives the request and displays the selected text and the requested action in an appropriate way.
7. The user can see which action was requested and what text was selected.

### Important scope boundary

This slice is about context-menu registration, selection capture, routing, and panel handoff.

Do not implement the full translation or reply-generation workflows from Slice 2.2.2.

Do not send a Gemini request from the service worker or content script.

Do not bypass the existing safety architecture.

## 4. Technical requirements

- Use `chrome.contextMenus` APIs correctly.
- Register menu items reliably when the extension is installed or updated.
- Avoid duplicate menu items after service-worker restarts.
- Use the existing service-worker architecture.
- Use the appropriate Chrome side-panel API to open Sahayak for the originating tab.
- Use the selected text supplied by the context-menu event where available.
- Validate and sanitize incoming message data.
- Handle empty selections gracefully.
- Handle restricted pages such as `chrome://` and other unsupported pages safely.
- Handle missing tabs and side-panel opening failures without crashing.
- Preserve tab-specific context. Never send selected text to the wrong tab's conversation.
- Do not place selected text in URLs or expose it in logs unnecessarily.
- Keep the API key exclusively in the existing side-panel AI flow.
- Follow the existing English/Hinglish preference conventions.
- Keep UI changes consistent with the existing Sahayak design.

If the existing architecture requires a new message type or helper function, add it without breaking existing message contracts.

## 5. Testing requirements

Add or update focused unit tests for:

- Context-menu item registration.
- Duplicate registration prevention.
- Correct action identification for Explain, Translate, and Draft reply.
- Correct selected-text transfer.
- Correct originating tab ID transfer.
- Empty selection handling.
- Invalid action rejection.
- Invalid or missing tab handling.
- Side-panel opening failure handling.
- No API key exposure.
- No accidental modification of existing Page Chat and session-store behavior.

Run relevant existing tests too.

Do not weaken, delete, skip, or rewrite existing tests just to make the new tests pass.

## 6. Regression protection

Before finishing, verify that these existing files and features remain functional:

- Existing Week 1 safety gate.
- Existing settings and API key storage.
- Existing language preference persistence.
- Existing Page Chat.
- Existing per-tab conversation history.
- Existing tab-close cleanup in the service worker.
- Existing Gemini streaming provider.
- Existing progressive streaming UI.
- Existing Page Chat truncation behavior.

Run syntax checks on every changed JavaScript file.

Run the relevant existing unit tests, especially:

- `tests/unit/page-chat.test.js`
- `tests/unit/session-store.test.js`
- `tests/unit/selection-explain.test.js`

Use the actual test paths in the repository.

## 7. Implementation discipline

Work only on Slice 2.2.1.

Before editing:
- Report the existing files and functions you intend to modify.
- Explain how the new context-menu flow will integrate with the existing architecture.
- Identify any potential regression risks.

Then implement the slice using minimal additive changes.

Do not stop after creating menu labels. The complete selection-to-side-panel handoff must work.

After implementation:
- Report every created and modified file.
- Explain each change.
- Show test commands and actual results.
- Identify any manual browser tests still pending.
- Clearly report any limitations.

**Do not claim completion unless the implementation and tests support it.**

Stop after Slice 2.2.1. Do not start Slice 2.2.2 or any later slice. Wait for my approval.
=============================================================================================
Implement **Week-2 Slice 2.2.2 only: Translate + Draft reply variants (Email / LinkedIn / Forum)**.

Repository: `Sahayak-AI-Agent`  
Active implementation folder: `Week-2`

**First inspect, then implement.**

Before editing:
1. Inspect the current worktree changes. Do not overwrite or discard existing changes.
2. Read the existing context-menu handoff implementation, panel UI/rendering, Explain/AI provider integration, preferences/language storage, safety gate, and relevant tests.
3. Check how the existing `translate` and `draft-reply` actions are represented and received by the panel.
4. Identify reusable functions and existing UI conventions. Do not duplicate existing functionality.

**Requirements from `docs/implementation-plan.md`:**

A. Translation
- Use the selected text received through the existing context-menu handoff.
- Translate into the user's configured target language.
- Follow the documented Hindi fallback when no target language is configured.
- Render the translation clearly in the panel.
- Handle empty selection, missing API key, provider errors, and empty AI responses.

B. Draft reply
- When `draft-reply` is requested, show a context picker with exactly three variants:
  - Email
  - LinkedIn
  - Forum
- Generate the draft using the selected text, the chosen context, an appropriate tone, and permitted page context.
- Render the resulting draft in the panel.
- Do not generate a draft before the user chooses a context.
- Handle empty selection and provider failures.

C. Prompt templates
Create:
- `Week-2/panel/prompts/translate.js`
- `Week-2/panel/prompts/draft.js`

Use separate, testable prompt builders. Keep prompts grounded in supplied text and context. Never pass raw page HTML to the model.

D. Safety and architecture
- Run the existing read-safety gate before any selected text or page context reaches an AI provider.
- Reuse existing provider integration and preference handling.
- AI calls must remain in the side panel.
- Never expose or pass API keys to content scripts or the background worker.
- Preserve the existing context-menu routing and storage handoff.
- Do not introduce a backend or autonomous browser actions.

**Tests required:**
- Three distinct draft-context templates.
- Translation target-language behavior, including fallback.
- Empty-selection refusal.
- Safety gate is called before provider invocation.
- Correct rendering for Translate, Email, LinkedIn, and Forum.
- Existing context-menu, Page Chat, session-history, and streaming tests remain passing.

**Strict boundaries:**
- Do not modify Week-1.
- Do not edit duplicate root-level files.
- Do not implement Screenshot-and-Ask or any Week-3 functionality.
- Do not rewrite entire files when a small scoped change is sufficient.
- Do not change completed 2.1.x behavior unless a demonstrated regression requires it.

Run the relevant unit tests and syntax checks. Report changed files, implementation details, test results, and manual Chrome tests still pending.

Stop after Slice 2.2.2. Do not begin another slice.
=========================Prompt===================================================================
Do not modify any files further.

Request permission to run the validation commands for Slice 2.2.2. Once permission is granted:

1. Run the focused context-actions and context-menus tests.
2. Run the translation and draft prompt tests.
3. Run the Page Chat, session-history, Explain, and streaming regression suites.
4. Run syntax checks on all changed JavaScript files.
5. Report each command and its actual pass/fail result.
6. If anything fails, report the exact failure. Do not silently fix unrelated code or claim success.

Do not proceed to another slice until validation is complete and results are reviewed.
------------------------------------------------------------------------------------------
Fix the Slice 2.2.2 Draft context picker UI.

Current issue: In the Sahayak side panel, the options render as `EmailLinkedInForum` with no visible spacing, button styling, or clear clickable targets. Users cannot tell where to click.

Requirements:
- Render Email, LinkedIn, and Forum as three separate, clearly visible buttons.
- Add spacing between buttons and visible hover, focus, and selected states.
- Make the entire button area clickable.
- Ensure clicking an option updates the selected context and triggers the intended draft flow.
- Keep generated drafts private inside Sahayak. Never submit or post them to the source website.
- Preserve translation, Explain, Page Chat, session history, and streaming behavior.
- Inspect existing files and current worktree changes before editing.
- Make only the necessary scoped changes. Do not modify Week-1 or root duplicates.
- Add/update focused tests and run relevant validation.
- Stop after this UI fix and report changed files and test results.
---------------------------------------------------------------------------------------
The previous UI fix did not solve the problem. After reloading the extension, the context picker still appears as `EmailLinkedInForum` with no visible spacing or distinct button layout.

Do not assume the fix worked just because automated tests passed.

Inspect the CURRENT contents of:
- Week-2/side-panel.html
- Week-2/side-panel.css
- Week-2/panel/features/context-actions.js

Find the exact HTML element and CSS selectors responsible for rendering Email, LinkedIn, and Forum.

Identify why the three options still appear joined together. Check for:
- Incorrect or missing CSS selectors
- Styles overridden by later rules
- Buttons rendered as inline elements without spacing
- Incorrect class names between HTML and CSS
- Container layout problems

Then make the smallest targeted fix.

Requirements:
1. Three visibly separate buttons.
2. Each button must have padding and spacing.
3. Selected context must have a clearly visible selected state.
4. Clicking each button must generate the corresponding draft.
5. Drafts must remain private inside Sahayak.
6. Do not modify unrelated features or Week-1/root files.

Add a focused test only if needed. Run relevant tests and syntax checks.

Report the exact root cause, changed CSS/HTML, and validation results. Do not claim the visual issue is fixed until manually verified in Chrome.
-----------------------------------------------------------------------------------------------
Critical UI bug: In the Sahayak side panel, I cannot read even ONE word of the selected text. The selected text is received (it appears in the panel's extracted content), but its display area is too small or clipped.

Fix the actual rendering issue.

Inspect:
- Week-2/side-panel.html
- Week-2/side-panel.css
- Week-2/panel/features/context-actions.js
- The code responsible for rendering selected text and AI responses.

Requirements:
1. Selected text must be displayed in a readable, multiline area.
2. Show enough height for several lines, with text wrapping.
3. Allow vertical scrolling for long selections.
4. Generated translations and drafts must also be readable, with normal font size and wrapping.
5. Context picker must show three separate clickable buttons: Email, LinkedIn, Forum.
6. Keep Copy functionality available.
7. Do not change the selected text, truncate it unnecessarily, or send drafts to the source website.
8. Preserve existing Explain, Page Chat, history and streaming functionality.

First identify the exact CSS/layout cause. Then make the smallest targeted fix, run relevant tests, and report changed files.

Do not claim the issue is fixed until it is visually verified in Chrome.
-------------------------------------------------------------------------------------------
The selected text is now readable, but other parts of the Sahayak side panel are still partially hidden/clipped.

Fix these specific areas too:

1. **Page Chat description**
   `Ask a question about this page. Answers use only its readable article text.`
   This entire sentence must be visible, not cut off.

2. **Page Chat input and Send button**
   `Question about this page` and `Send` must be fully visible. The input must have enough height and must not be clipped.

3. **Week 3 information**
   `Proposed browser actions and approval controls will appear here (Week 3).`
   The entire text must be visible and readable, including the following explanatory text:
   `Approvals and other browser actions are added in later slices.`

4. **Context picker**
   Email, LinkedIn and Forum must appear as three separate, clearly visible clickable buttons.

5. **Selected text and AI response**
   Keep the selected text, translation and generated draft readable, multiline, wrapped and scrollable when long.

**Investigation requirements:**
- Inspect the actual rendered DOM and computed styles.
- Check parent containers for `overflow: hidden`, fixed heights, insufficient `min-height`, flex shrinking, grid sizing and clipping.
- Identify the actual cause instead of blindly increasing heights.
- Make the smallest targeted CSS/layout changes.
- Ensure the side panel remains usable at its normal Chrome side-panel width and height.
- Do not hide or remove any existing content to make the layout appear fixed.

Run the relevant tests and syntax checks. Report the root cause and changed files.

Do not claim the UI is fixed until I reload the extension and visually verify all these sections in Chrome.

****************************************************************************************
Test it in Chrome/Edge using the unpacked Week-2 extension. We'll do one check at a time. Don't edit code during testing.
Step 1 — Test translation
1. Open a normal webpage containing English text, for example https://en.wikipedia.org/wiki/Artificial_intelligence.
2. Select one complete English paragraph.
3. Right-click the selected text.
4. Click Translate this.
5. Sahayak should open and receive the selected text.
6. Check that it generates a Hindi translation if no translation target is configured.


language-translator-ymo.en.softonic.com


Expected result:
- The selected text is passed to Sahayak.
- The translation is in Hindi when no target language is configured.
- The original English text is not merely repeated.
- No API key is visible in the UI or browser messages.
Pass condition
 A meaningful Hindi translation appears in the Sahayak chat.










--------------------------------------------------------------------------------------------
======================================================================================
We are starting Sahayak Week-2 Slice 2.3.1 — Visible-tab capture with crop UI.

Read the Week-2 assignment documents completely before coding:

- `Week-2/docs/problemStatement.md`
- `Week-2/docs/architecture.md`
- `Week-2/docs/implementation-plan.md`
- `Week-2/docs/edge-case.md`
- `Week-2/docs/promptsWeek2.md`

Follow the exact Slice 2.3.1 requirements.

**Objective:**
Capture the visible browser tab and let the user focus/crop the screenshot before analysis.

**Required implementation from the plan:**
- `panel/features/screenshot.js`
- `content/crop-driver.js`
- Use `chrome.tabs.captureVisibleTab`.
- Add the required `tabs` permission only if missing.
- Extend the existing router to accept `capture-screenshot`.
- Display a screenshot preview in the side panel.
- Allow the user to drag a crop selection over the preview.
- Clamp crop coordinates to image boundaries.
- Reduce oversized images.
- Keep screenshot data in panel memory only; never persist it.
- Only the cropped image may leave the browser for later Gemini vision analysis.
- Never route screenshot/image requests to Groq.
- Preserve the existing MV3 architecture and safety requirements.

**Acceptance criteria:**
1. Screenshot capture works on a normal webpage.
2. User can select a crop region.
3. Crop is applied correctly.
4. Crop coordinates are clamped.
5. Oversized images are reduced.
6. Only the cropped image is passed onward.
7. Screenshot data is not persisted.

**Chrome test required by the plan:**
Open a webpage containing a chart, click Screenshot-and-Ask, crop the chart, and verify that the crop contains the intended chart region.

**Important constraints:**
- Modify Week-2 only.
- Do not touch Week-1 or root duplicates.
- Preserve completed 2.1.x and 2.2.x behavior.
- Do not implement Slice 2.3.2 yet.
- Do not implement provider reliability or Week-3 features early.
- Add focused unit tests.
- Inspect existing code before editing; reuse existing architecture.
- Do not perform broad rewrites.

**First response only:** Report the exact requirements, existing files to reuse, proposed files to change, dependencies, and implementation steps. Do not edit code yet.
-------------------------------------------------------------------------------------------
The plan is approved. Proceed with the smallest implementation for Week-2 Slice 2.3.1.

Before editing:
1. Verify that `Week-2/manifest.json` already contains the required `tabs` permission.
2. Verify the existing router handles `capture-screenshot`.
3. Account for the documented `content/crop-driver.js` component. Reuse it if appropriate; explain if the existing architecture makes it unnecessary.

Implement:
- `Week-2/panel/features/screenshot.js`
- The required crop interaction component.
- Router integration only if needed.
- Screenshot preview and drag-to-crop UI.
- Boundary-clamped crop coordinates.
- Fixed, documented maximum image dimensions for oversized captures.
- In-memory screenshot handling only.
- Cropped image as the only output exposed for the later vision slice.

Do not:
- Persist screenshots or crops.
- Add Gemini/Groq provider calls.
- Implement Slice 2.3.2 or later slices.
- Modify Week-1, root duplicates, or completed 2.1.x / 2.2.x behavior.

Add focused tests for capture handling, crop coordinates, image-size reduction, and ensuring the full screenshot is not exposed as the analysis output.

Run focused tests and relevant regression tests. Report exact files changed and test totals. Do not claim Chrome verification unless performed.
===========================================================================================
Investigate the Chrome runtime failure in Week-2 Slice 2.3.1.

Actual browser result:
Clicking "Capture visible tab" displays:
"Sahayak could not capture the visible tab. Bring it to the front and try again."

Inspect only these existing Week-2 files:
- background/router.js
- background/service-worker.js
- panel/features/screenshot.js
- panel/safety-gate.js
- manifest.json

Determine:
1. What exact arguments are passed to chrome.tabs.captureVisibleTab?
2. Is the correct browser window being targeted?
3. Does the side-panel button click have the required activeTab permission context?
4. Is the runtime message reaching the service worker?
5. Is the actual Chrome API error being swallowed by the generic error handler?

Do not edit files yet.
Do not weaken or bypass the safety gate.
Do not add permissions without explaining why they are required.
Do not modify Week-1, root duplicates, or completed slices.

Report the most likely root cause and the smallest safe fix.
-----------------------------------------------------------------------------------------
We are implementing **Sahayak — Week-2, Slice 2.3.2: Gemini Vision Q&A**.

Repository:
`C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent`

Active scope: `Week-2` ONLY.

## Current status
- Week-1 is complete and frozen.
- Week-2 slices 2.1.1 through 2.2.2 are complete.
- Slice 2.3.1 (screenshot capture and cropping) is implemented, unit-tested, and manually verified in Chrome.
- The screenshot crop is held in panel memory and exposed through `getCroppedImage()`.
- Do not rewrite or unnecessarily modify the completed screenshot/crop implementation.

## Your task
First, inspect the Week-2 documentation, especially:
- `Week-2/docs/problemStatement.md`
- `Week-2/docs/architecture.md`
- `Week-2/docs/implementation-plan.md`
- `Week-2/docs/edge-case.md`
- `Week-2/docs/promptsWeek2.md`

Then inspect the existing screenshot, provider, router, safety, and test implementations.

## Slice 2.3.2 requirements
Implement only:
- `Week-2/providers/gemini-vision.js`
- `Week-2/panel/prompts/screenshot-qa.js`
- Minimum necessary integration with the existing panel/router architecture.

Requirements:
1. Use Gemini exclusively for image-based questions.
2. Send the cropped image from `getCroppedImage()`, never the original full screenshot.
3. Include the user's question alongside the cropped image.
4. Ground answers strictly in visible image content.
5. Do not invent text, values, labels, or details that are not visible.
6. Return an understandable error when the image is missing, invalid, or Gemini provides no usable response.
7. Never send image data to Groq or any text-only fallback provider.
8. Preserve existing safety checks and error handling.
9. Keep screenshot data in panel memory only. Do not persist images or crops.
10. Do not expose API keys to content scripts or the webpage.

## Important boundaries
- Do not implement provider retries, model tiering, Groq fallback, or later Week-2 slices.
- Do not implement Week-3 features.
- Do not modify Week-1, root duplicates, or unrelated completed slices.
- Do not add unnecessary permissions or change shared message contracts unless the architecture requires it.
- Preserve all existing functionality.

## Tests required
Add focused tests for:
- Gemini receives the cropped image and user's question.
- Full screenshot data is never sent.
- Image requests are rejected by Groq or any text-only provider.
- Missing or invalid crops produce understandable errors.
- Empty or unusable Gemini responses produce understandable errors.
- Answers remain grounded in image content as far as the implementation can enforce.

Run relevant existing regression tests as well.

## First response — planning only
Do not edit files yet.

Report:
1. Exact documentation requirements for Slice 2.3.2.
2. Existing files and functions that should be reused.
3. Proposed files to create or modify.
4. How you will guarantee that only the cropped image reaches Gemini.
5. How you will prevent image data from reaching Groq.
6. Focused tests and regression suites.
7. Any architectural conflicts or missing dependencies.

Wait for approval before implementation.
--------------------------------------------------------------------------------------------
We are starting Sahayak Week-2, Slice 2.4.1 — Provider abstraction + retry/backoff on 429.

Repository:
`C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent`

Active scope: `Week-2` ONLY.

## Completed work
- Week-1 is complete and frozen.
- Week-2 slices 2.1.1 through 2.3.2 are implemented and manually verified.
- Screenshot Q&A uses Gemini Vision exclusively.
- Existing functionality and completed slices must be preserved.

## First inspect the documentation
Read:
- `Week-2/docs/problemStatement.md`
- `Week-2/docs/architecture.md`
- `Week-2/docs/implementation-plan.md`
- `Week-2/docs/edge-case.md`
- `Week-2/docs/promptsWeek2.md`

Then inspect the existing provider implementations and their callers.

## Slice 2.4.1 requirements

The documented components include:
- `Week-2/providers/base.js`
- `Week-2/providers/retry.js`
- `Week-2/providers/gemini.js`
- `Week-2/providers/groq.js`

Implement the provider abstraction and bounded retry behavior required by the documentation.

Requirements:
1. Unify provider invocation through the documented `callAI(task)` abstraction.
2. Implement bounded retries for HTTP 429 rate-limit responses.
3. Use exponential backoff with jitter.
4. Introduce or reuse the documented `UnavailableError`.
5. Return understandable errors when retries are exhausted or a provider is unavailable.
6. Preserve existing provider-specific behavior where appropriate.
7. Ensure retries do not become infinite.
8. Ensure non-retryable errors are not retried unnecessarily.
9. Keep Gemini Vision image requests separate from text-only provider fallback.
10. Preserve safety checks and existing error handling.

## Strict boundaries
- Modify Week-2 only.
- Do not modify Week-1 or root duplicates.
- Do not implement model tiering (2.4.2).
- Do not implement Groq fallback/eligibility changes (2.4.3).
- Do not implement centralized UI errors (2.4.4).
- Do not implement Week-3 features.
- Avoid unnecessary manifest, router, or UI changes.
- Preserve all completed 2.1.x, 2.2.x, and 2.3.x behavior.

## First response: planning only
Do not edit files yet.

Report:
1. Exact requirements from the implementation plan.
2. Existing provider architecture and callers.
3. Files to create or modify.
4. Retry algorithm, maximum attempts, backoff and jitter strategy.
5. How 429 errors will be identified.
6. How other errors will be handled.
7. How Gemini Vision remains protected from text-only fallback.
8. Focused tests and regression suites.
9. Any architectural conflicts or missing dependencies.

Wait for approval before implementing.
--------------------------------------------------------------------------------------------

We are starting Sahayak Week-2, Slice 2.4.1 — Provider abstraction + retry/backoff on 429.

Repository:
`C:\Users\psinh\Desktop\MasaiProjects\Sahayak-AI-Agent`

Active scope: `Week-2` ONLY.

## Completed work
- Week-1 is complete and frozen.
- Week-2 slices 2.1.1 through 2.3.2 are implemented and manually verified.
- Screenshot Q&A uses Gemini Vision exclusively.
- Existing functionality and completed slices must be preserved.

## First inspect the documentation
Read:
- `Week-2/docs/problemStatement.md`
- `Week-2/docs/architecture.md`
- `Week-2/docs/implementation-plan.md`
- `Week-2/docs/edge-case.md`
- `Week-2/docs/promptsWeek2.md`

Then inspect the existing provider implementations and their callers.

## Slice 2.4.1 requirements

The documented components include:
- `Week-2/providers/base.js`
- `Week-2/providers/retry.js`
- `Week-2/providers/gemini.js`
- `Week-2/providers/groq.js`

Implement the provider abstraction and bounded retry behavior required by the documentation.

Requirements:
1. Unify provider invocation through the documented `callAI(task)` abstraction.
2. Implement bounded retries for HTTP 429 rate-limit responses.
3. Use exponential backoff with jitter.
4. Introduce or reuse the documented `UnavailableError`.
5. Return understandable errors when retries are exhausted or a provider is unavailable.
6. Preserve existing provider-specific behavior where appropriate.
7. Ensure retries do not become infinite.
8. Ensure non-retryable errors are not retried unnecessarily.
9. Keep Gemini Vision image requests separate from text-only provider fallback.
10. Preserve safety checks and existing error handling.

## Strict boundaries
- Modify Week-2 only.
- Do not modify Week-1 or root duplicates.
- Do not implement model tiering (2.4.2).
- Do not implement Groq fallback/eligibility changes (2.4.3).
- Do not implement centralized UI errors (2.4.4).
- Do not implement Week-3 features.
- Avoid unnecessary manifest, router, or UI changes.
- Preserve all completed 2.1.x, 2.2.x, and 2.3.x behavior.

## First response: planning only
Do not edit files yet.

Report:
1. Exact requirements from the implementation plan.
2. Existing provider architecture and callers.
3. Files to create or modify.
4. Retry algorithm, maximum attempts, backoff and jitter strategy.
5. How 429 errors will be identified.
6. How other errors will be handled.
7. How Gemini Vision remains protected from text-only fallback.
8. Focused tests and regression suites.
9. Any architectural conflicts or missing dependencies.

Wait for approval before implementing.

-------------------------------------------------------------------------------------
Approved. Proceed with Slice 2.4.1 under the agreed plan.

Additional implementation requirements:

1. Make retry delays and jitter deterministic in tests through injected or mocked dependencies. Do not make the test suite wait for real backoff delays.
2. For streaming, explicitly track whether any chunk has been emitted. Retry only if the failure occurs before the first emitted chunk. Never restart a stream after partial output.
3. Ensure retry limits are finite and documented.
4. Preserve the existing `{ ok, error, message }` result contract and current feature-renderer behavior.
5. Keep image-bearing tasks exclusively on Gemini Vision. No Groq invocation or fallback.
6. Preserve all existing safety checks and completed Week-2 functionality.

Implement only Slice 2.4.1. Do not implement 2.4.2, 2.4.3, 2.4.4, or Week-3 features.

After implementation:
- Run focused retry/provider tests.
- Run the specified regression suites.
- Run the complete Week-2 unit suite.
- Run `node --check` on changed JavaScript files.
- Validate manifest JSON if modified.
- Run `git diff --check`.
- Report exact files changed, retry limits and delays, and exact test totals.
- Do not claim Chrome verification unless actually performed.

Keep all changes inside Week-2 and preserve pre-existing uncommitted work.
-----------------------------------------------------------------------------
Next: Chrome verification
1. Open chrome://extensions.
2. Reload Sahayak.
3. Open a Wikipedia article.
4. Test Page Chat.
5. Test Explain.
6. Test Summarise.
7. Test YouTube summarisation.
8. Test screenshot Q&A.
Check that successful requests still produce responses and that existing features have not regressed.

You cannot reliably test actual HTTP 429 retry behavior just by clicking buttons. The unit tests cover that policy; don't deliberately exhaust your API quota.
-------------------------------------------------------------------------------------
Investigate a Chrome regression in Sahayak Week-2. Do not edit any files yet.

## Observed problem

In Chrome, on a Wikipedia article:

1. I click Explain in the Sahayak side panel.
2. Sahayak displays:
   "Sahayak is now listening for your selection. Select any text on the page, then press Explain again."
3. I select text on the webpage and click Explain again.
4. The same listening message appears. No explanation is generated.

The side panel still displays previously selected text under "Selected text".

## Recent changes

Slice 2.4.1 introduced provider abstraction and retry/backoff.

Changed files included:
- `Week-2/panel/features/explain.js`
- `Week-2/providers/base.js`
- `Week-2/providers/retry.js`
- `Week-2/providers/gemini.js`
- `Week-2/panel/side-panel.html`

Before this slice, Explain and streaming had been manually verified successfully.

## Investigation scope

Inspect only Week-2:
- `panel/features/explain.js`
- `panel/features/context-actions.js`
- `panel/side-panel.html`
- `panel/side-panel.css`
- `background/router.js`
- `background/service-worker.js`
- `providers/base.js`
- `providers/retry.js`
- `providers/gemini.js`
- relevant selection-explain and provider tests.

Determine:

1. Why does clicking Explain repeatedly enter selection mode instead of processing the selected text?
2. Is the selection text actually being captured and delivered to the panel?
3. Is the Explain button's event handler being registered or executed twice?
4. Is the existing selected text being cleared or ignored?
5. Does the new `callAI(task)` integration receive the correct Explain task?
6. Is a provider error preventing the response from rendering?
7. Does the streaming path still update the assistant message after receiving chunks?
8. Are there any Chrome runtime or service-worker errors?

Compare the current implementation with the last working behavior if Git history or existing tests allow it.

## Restrictions

- Do not edit files.
- Do not rewrite the selection workflow.
- Do not weaken safety checks.
- Do not modify Week-1, root duplicates, or unrelated completed slices.
- Do not claim a cause without evidence.

## Report

Give me:
- The exact root cause, if established.
- The exact function and file responsible.
- Whether this is a selection-flow bug, provider-integration bug, or both.
- The smallest safe fix.
- Tests that should be added or updated.

Wait for approval before implementing anything.

-----------------------------------------------------------------------------------
