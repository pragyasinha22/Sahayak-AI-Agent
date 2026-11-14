# Problem Statement: Sahayak – AI-Powered Browser Assistant

## 1. Project Overview

Build **Sahayak**, a Chrome side-panel AI agent that understands the webpage currently open in the browser and helps users interact with it safely.

Sahayak should act as an intelligent browser assistant. It should read webpage content, answer questions using page context, explain selected text, understand screenshots, identify interactive elements, and help users complete browser tasks.

The agent must never perform an action without the user's explicit approval.

### Core Capabilities

- Summarise articles and public YouTube videos in English or Hinglish.
- Chat with the currently open webpage and answer questions using only the page content.
- Explain, translate, or draft replies based on selected webpage content.
- Understand screenshots, charts, diagrams, forms, and error messages.
- Identify buttons, links, inputs, dropdowns, and other interactive elements.
- Help users complete browser tasks through a one-step-at-a-time approval process.
- Remember a local user profile and reusable prompt skills.
- Enforce safety rules before reading sensitive pages or performing actions.

---

## 2. Four-Week Development Plan

### Week 1 – The Eyes: Read the Web

Build the Chrome extension foundation and implement webpage reading capabilities.

#### 2.1 Chrome Extension Foundation

- Use Chrome Extension Manifest V3.
- Use the Chrome Side Panel API.
- Create the extension manifest, side panel UI, background service worker, and required content scripts.
- Add a settings screen where users can configure their Gemini API key.
- Support loading the extension locally through Chrome's Load unpacked option.

#### 2.2 Selected Text Explanation

- Allow users to select text on a webpage.
- Provide an option to explain the selected text.
- Display the explanation inside the Sahayak side panel.

#### 2.3 Article Extraction

- Use Mozilla Readability.js to extract the main article content.
- Exclude unnecessary webpage elements such as navigation bars, advertisements, sidebars, and footers.
- Extract the article title and readable main content.

#### 2.4 Article Summarisation

Generate a structured summary containing:

1. One-line TL;DR.
2. Five key points.
3. What to do next.

#### 2.5 YouTube Summarisation

- Support public YouTube video links.
- Generate summaries of supported public videos.
- Provide chapter-style notes with timestamps when transcript or timestamp information is available.
- Clearly handle videos that cannot be accessed or summarised.
- Private videos and unsupported content are outside the project scope.

#### 2.6 Language Support

- Add an English/Hinglish language toggle.
- Allow users to switch the assistant's response language.

#### 2.7 Optional Offline Support

- Explore Chrome built-in AI capabilities for offline summarisation when supported by the user's device and browser.
- This is optional and must not block the main functionality.

---

### Week 2 – The Brain: Understand the Page and Screen

Implement page-aware conversations, context-menu actions, screenshot understanding, and API reliability.

#### 2.8 Chat With the Current Page

- Allow users to ask questions about the currently open webpage.
- Use extracted webpage content as the context for answers.
- Answer only using information available in the provided page context.
- If the answer is not available in the page, clearly say that the page does not provide the information.
- Maintain conversation history for the active conversation.
- Support streaming responses when the model API allows it.

#### 2.9 Context Menu Actions

Add right-click actions for selected webpage text:

- Explain this.
- Translate this into Hindi or the selected language.
- Draft a reply.

Draft replies should support contexts such as:

- Email.
- LinkedIn.
- Online forums.

Display the generated result in the Sahayak side panel.

#### 2.10 Screenshot-and-Ask

- Allow users to capture the visible browser tab.
- Let users ask questions about visual content.
- Support charts, diagrams, error messages, forms, and other visible webpage elements.
- Allow users to focus, crop, or restrict the relevant screenshot region before sending it for analysis.

#### 2.11 API Reliability and Free-Tier Resilience

- Handle Gemini API errors, including HTTP 429 rate-limit responses.
- Implement appropriate retry and backoff behaviour.
- Use a lighter Gemini model by default.
- Use a stronger Gemini model only when necessary.
- Support Groq text-only fallback for eligible tasks.
- Show understandable error messages instead of crashing.
- Handle unavailable APIs and network failures gracefully.

---

### Week 3 – The Hands: Act With User Approval

Build a controlled browser agent that can identify page elements and help users complete tasks safely.

#### 2.12 Interactive Element Scanner

Create a content script that scans the current webpage for supported interactive elements, including:

- Buttons.
- Links.
- Text inputs.
- Textareas.
- Dropdowns and select elements.
- Checkboxes.
- Other supported action elements.

Assign a stable number to each detected element for the current page state.

Display numbered badges or overlays on the webpage so users can identify elements.

#### 2.13 Structured Action Map

- Convert detected elements into a compact structured action map.
- Include useful information such as element number, type, visible text, label, placeholder, and relevant attributes.
- Do not send the entire raw HTML document to the AI model.
- Refresh the action map when the webpage changes.

#### 2.14 Find It for Me

Allow users to describe an element in natural language.

Example:

"Where do I upload my resume?"

The assistant should:

1. Analyse the structured action map.
2. Identify the most relevant element.
3. Return a strict JSON selection.
4. Highlight the selected element on the webpage.
5. Never click or interact automatically.

#### 2.15 Approval-Based Browser Agent

Implement a one-step-at-a-time agent workflow.

The required workflow is:

1. Read the current webpage state.
2. Build or refresh the interactive action map.
3. Ask the AI for the single next action.
4. Receive a structured JSON response.
5. Validate the proposed action.
6. Display the proposed action and its reason to the user.
7. Wait for the user's explicit decision.
8. Execute the action only after approval.
9. Read the updated webpage state.
10. Repeat until the task is complete or the user stops it.

Supported actions:

- `click`
- `type`
- `select`
- `scroll`
- `done`

Each proposed action should contain:

- Action type.
- Target element number, when applicable.
- Value, when applicable.
- A short explanation of why the action is proposed.

#### 2.16 Agent Controls

Provide the following controls:

- **Approve:** Execute the proposed action.
- **Skip:** Do not execute the proposed action and move on safely.
- **Stop:** Immediately stop the agent.
- **Dry Run:** Highlight the intended element without performing the action.
- Maximum step limit to prevent endless execution.
- Persist approval and task progress across service-worker suspension.
- Maintain an action log showing proposed actions, reasons, and user decisions.

#### 2.17 Practice Tasks

Demonstrate the agent using controlled practice environments:

1. Multi-step internship application.
2. Practice online shop search and filtering.
3. Collect information across multiple pages and organise it into a table.

The agent must request approval for every action.

---

### Week 4 – Memory, Safety, and Shipping

Implement local user preferences, reusable skills, safety enforcement, and project distribution.

#### 2.18 Local User Profile

Use `chrome.storage.local` to store a user profile containing:

- Name.
- College.
- Skills.
- Relevant links.
- Preferred language.
- Preferred writing tone.

Allow the assistant to reuse this information in supported forms, drafts, and common workflows.

Profile data should remain local unless the user explicitly chooses to provide relevant information to an external service.

#### 2.19 Reusable Prompt Skills

Provide one-click reusable prompt recipes, such as:

- Create exam notes.
- Explain in Hinglish.
- Write a polite email reply.
- Fill a form using my profile.

Allow users to:

- Create and save skills.
- Reuse saved skills.
- Import skills from a local file.
- Export skills to a local file.

#### 2.20 Safety Enforcement

Implement safety restrictions directly in application code.

The system must:

- Block agent actions on banking and payment pages.
- Never type into password fields.
- Never type into OTP fields.
- Never type into card-information fields.
- Require additional confirmation before consequential actions such as Submit, Pay, and Send.
- Provide an immediate Stop or kill-switch control.
- Prevent API keys from being committed to public GitHub.
- Avoid sending private or sensitive pages to free-tier AI services.
- Restrict practice errands to provided practice environments or pages the user owns or controls.
- Never automate login, payment, OTP, or password workflows.

Safety checks must be deterministic and must not depend only on AI instructions.

#### 2.21 Distribution and Documentation

Prepare the project for public demonstration and installation.

Required deliverables:

- Public GitHub repository.
- Clean and complete README.
- Installation and setup instructions.
- Screenshots demonstrating important features.
- GitHub Release containing an installable ZIP.
- Instructions for installing through Chrome's Load unpacked option.
- One-page GitHub Pages landing page.

Chrome Web Store publication is not required.

---

## 3. Functional Requirements

The project must satisfy the following functional requirements.

| ID | Requirement |
|---|---|
| FR-1 | Provide a Chrome Side Panel interface. |
| FR-2 | Provide settings for API keys and preferences. |
| FR-3 | Extract readable webpage content. |
| FR-4 | Summarise articles and supported public YouTube videos. |
| FR-5 | Answer questions using only current-page context. |
| FR-6 | Understand screenshots and visual webpage content. |
| FR-7 | Generate structured and validated agent decisions. |
| FR-8 | Require explicit user approval before every browser action. |
| FR-9 | Store a local user profile and reusable skills. |
| FR-10 | Enforce safety restrictions through application code. |

---

## 4. Non-Functional Requirements

### 4.1 Reliability

- Handle API failures and rate limits.
- Validate AI-generated JSON before using it.
- Preserve task progress across service-worker suspension.
- Prevent invalid actions from being executed.

### 4.2 Privacy

- Keep API keys out of source control.
- Store profile information locally.
- Avoid sending sensitive webpage content to external AI services.
- Send only the necessary page content for the requested task.

### 4.3 Safety

- Never execute an agent action without explicit approval.
- Enforce deterministic restrictions for protected pages and fields.
- Require extra confirmation for consequential actions.
- Make the Stop control immediately accessible.

### 4.4 Cost

- Keep the core project usable with free-tier services where possible.
- Use lightweight models by default.
- Use fallback providers only for eligible tasks.

### 4.5 Usability

- Make the side panel easy to access.
- Show understandable error messages.
- Clearly display proposed browser actions.
- Make approval, skip, stop, and dry-run controls easy to understand.

---

## 5. Technical Constraints

- Platform: Google Chrome desktop extension.
- Extension standard: Manifest V3.
- Main interface: Chrome Side Panel API.
- AI provider: Gemini as the primary provider.
- Fallback provider: Groq for eligible text-only tasks.
- Article extraction: Mozilla Readability.js.
- Local storage: Chrome Storage API.
- Browser interaction: Content scripts and supported Chrome extension APIs.
- No unnecessary backend should be introduced.
- Keep API keys out of public source control.

Important security consideration: API keys used by a distributed browser extension cannot be treated as truly secret because users can inspect extension files and runtime behaviour. Never commit a real key to GitHub. Clearly document this limitation and avoid describing browser storage as an encrypted secret vault.

---

## 6. Out of Scope

The following features are not required:

- Mobile browser extensions.
- Autonomous browser execution without user approval.
- Banking or payment automation.
- Login, OTP, password, or card-information automation.
- Sending private pages to free-tier AI services.
- Risky automation on arbitrary third-party websites.
- Chrome Web Store publication.

---

## 7. Definition of Done

The project is considered complete when a new user can:

1. Install the extension from the GitHub Release ZIP.
2. Load the extension in Chrome using Load unpacked.
3. Open the Sahayak side panel.
4. Enter their own API key.
5. Summarise a supported article.
6. Summarise a supported public YouTube video.
7. Switch between English and Hinglish.
8. Ask questions about the current webpage and receive page-grounded answers.
9. Explain, translate, and draft replies from selected text.
10. Capture a screenshot and ask questions about its contents.
11. Find and highlight an interactive webpage element.
12. Complete supported practice browser tasks using the approval-based agent.
13. Approve, skip, or stop proposed actions.
14. Use dry-run mode and view the action log.
15. Create and reuse a local user profile.
16. Create, export, and import reusable skills.
17. See protected pages, sensitive fields, and restricted actions blocked by safety checks.
18. Read the project documentation and set up the extension independently.

All critical functionality must be tested in Chrome before the project is considered complete.

---

## 8. Development Rules

- Implement one planned development slice at a time.
- Do not start the next slice until the current slice runs successfully in Chrome and its acceptance checks pass.
- Follow the architecture and implementation plan documents.
- Do not implement future features early.
- Do not introduce an unnecessary backend.
- Keep AI API calls inside the side panel; content scripts must never receive API keys.
- Store approval and task progress in `chrome.storage.session` rather than relying only on service-worker memory.
- Implement safety checks as a pure, independently testable module early in development.
- Every later page-reading or browser-action path must pass the relevant safety checks.
- Add unit tests specified by each implementation slice.
- Test panel interactions, empty states, and error states in Chrome.
- Never bypass the user-approval requirement.

The implementation must prioritise correctness, safety, maintainability, and a professional user experience over adding features quickly.