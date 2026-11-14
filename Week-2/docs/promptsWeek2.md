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