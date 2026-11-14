'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Preferences = require('../../state/preferences.js');
const TranslatePrompt = require('../../panel/prompts/translate.js');
const DraftPrompt = require('../../panel/prompts/draft.js');
const ContextActions = require('../../panel/features/context-actions.js');
const Explain = require('../../panel/features/explain.js');
const ContextAction = require('../../shared/context-action.js');

globalThis.SahayakPreferences = Preferences;

const selectionTextCases = [
  'What technologies did you use to build your latest project, and what features does it support?',
  'What technologies did you use to build my latest project, and what features does it support?',
  'A semicolon; followed by what should remain unchanged;',
  "What's in the project, and what's supported?",
  'First line,\nwhat is on the next line?\nFinal line.',
  '¿Qué tecnologías usaste? Café — 東京 🙂',
  '  preserve surrounding spaces  '
];

let pass = 0;
let fail = 0;

function check(condition, message) {
  try {
    assert.ok(condition, message);
    pass += 1;
    console.log('  ✓ ' + message);
  } catch (error) {
    fail += 1;
    console.error('  ✗ ' + message);
    console.error(error.message);
  }
}

function makeRunDeps(overrides) {
  const options = overrides || {};
  const events = [];
  const rendered = [];
  const deps = {
    request: { action: 'translate', text: 'Selected source text', tabId: 7 },
    panel: {
      requestPageInfo: function (tabId) {
        events.push('page-info:' + tabId);
        return Promise.resolve({
          url: 'https://example.test/private/path?token=not-for-provider'
        });
      },
      guardRead: function () {
        events.push('guard');
        return Promise.resolve({ allowed: options.allowed !== false });
      }
    },
    classifier: {
      classifyText: function () {
        events.push('classify-text');
        return { class: 'ordinary' };
      }
    },
    preferences: {
      getTranslationTargetLanguage: function () {
        events.push('get-target-language');
        return Promise.resolve(options.targetLanguage || '');
      }
    },
    storageManager: {},
    translatePrompt: TranslatePrompt,
    draftPrompt: DraftPrompt,
    draftContexts: DraftPrompt.CONTEXTS,
    language: 'en',
    getKey: function () {
      events.push('get-key');
      return Promise.resolve('test-key');
    },
    callAI: function (request) {
      events.push('provider');
      if (options.onCallAI) options.onCallAI(request);
      return Promise.resolve({ ok: true, text: options.answer || 'Generated result.' });
    },
    render: function (state) { rendered.push(state); }
  };
  Object.assign(deps, options.deps || {});
  return { deps: deps, events: events, rendered: rendered };
}

async function main() {
  console.log('# context-picker markup and style contract');
  {
    const panelHtml = fs.readFileSync(
      path.join(__dirname, '../../panel/side-panel.html'),
      'utf8'
    );
    const panelCss = fs.readFileSync(
      path.join(__dirname, '../../panel/side-panel.css'),
      'utf8'
    );
    check(
      /<link rel="stylesheet" href="side-panel\.css"\s*\/>/.test(panelHtml) &&
        (panelHtml.match(/class="draft-context-btn"/g) || []).length === 3 &&
        panelCss.includes('flex: 0 0 auto;') &&
        panelCss.includes('overflow-y: auto;') &&
        panelCss.includes('min-height: 5rem;') &&
        panelCss.includes('max-height: 12rem;') &&
        panelCss.includes('white-space: pre-wrap;') &&
        panelCss.includes('.view-chat {') &&
        panelCss.includes('overflow-y: auto;') &&
        panelCss.includes('.view-chat > section {') &&
        panelCss.includes('flex-shrink: 0;') &&
        panelCss.includes('.chat-area {') &&
        panelCss.includes('min-height: 9rem;') &&
        panelCss.includes('#chat-send {') &&
        panelCss.includes('min-height: 2.6rem;') &&
        panelCss.includes('.review-area {') &&
        panelCss.includes('overflow: visible;') &&
        panelCss.includes('.app-footer {') &&
        panelCss.includes('.draft-context-buttons {') &&
        panelCss.includes('display: grid;') &&
        panelCss.includes('grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));') &&
        panelCss.includes('gap: 0.55rem;') &&
        panelCss.includes('padding: 0.5rem 0.85rem;') &&
        panelCss.includes('.draft-context-btn[aria-pressed="true"]') &&
        /<label[^>]*for="draft-project-facts"[^>]*>[\s\S]*?Optional project facts for this draft[\s\S]*?<\/label>\s*<p id="draft-trusted-facts-help"[^>]*>[\s\S]*?Included only in draft prompts; never saved or added to Page Chat\. Review or replace these facts for each selected message\. The selected comment is not evidence about your project\.[\s\S]*?<\/p>\s*<textarea[^>]*id="draft-project-facts"[^>]*class="draft-project-facts"[^>]*rows="4"[^>]*maxlength="2000"[^>]*aria-describedby="draft-trusted-facts-help"[^>]*placeholder="Optional: confirmed tools, features, or project details\.\.\."[^>]*wrap="soft"/.test(panelHtml) &&
        panelHtml.indexOf('id="draft-trusted-facts-help"') <
          panelHtml.indexOf('id="draft-project-facts"') &&
        panelHtml.indexOf('id="draft-project-facts"') <
          panelHtml.indexOf('id="chat-question"') &&
        panelHtml.includes('The selected comment is not evidence about your project.') &&
        /\.draft-context-picker\s*\{[^}]*display:\s*block;/.test(panelCss) &&
        panelCss.includes('height: 7rem;') &&
        panelCss.includes('min-height: 7rem;') &&
        panelCss.includes('border: 2px solid #94a3b8;') &&
        /\.draft-project-facts\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;/.test(panelCss) &&
        panelCss.includes('.draft-project-facts:focus-visible'),
      'linked panel stylesheet lays out three padded, spaced buttons with a selected state'
    );
    const textareaMarkup = panelHtml.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/);
    check(
      textareaMarkup &&
        /<label\b[^>]*for="draft-project-facts"[^>]*>[\s\S]*?Optional project facts for this draft/.test(panelHtml) &&
        /<textarea\b[^>]*\bid="draft-project-facts"[^>]*\bplaceholder="Optional: confirmed tools, features, or project details\.\.\."/.test(textareaMarkup[0]) &&
        /<textarea\b[^>]*\brows="4"/.test(textareaMarkup[0]) &&
        !/disabled|readonly|\bhidden\b/.test(textareaMarkup[0]) &&
        /<input\b[^>]*\bid="chat-question"/.test(panelHtml) &&
        !/id="draft-project-facts"[^>]*id="chat-question"/.test(panelHtml) &&
        DraftPrompt.CONTEXTS.every(function (context) {
          return new RegExp(
            '<button\\b(?=[^>]*class="draft-context-btn")' +
              '(?=[^>]*data-draft-context="' + context + '")' +
              '(?=[^>]*type="button")[^>]*>' + context + '<\\/button>'
          ).test(panelHtml);
        }),
      'actual panel HTML places an editable, separate facts textarea below its helper and provides three context buttons'
    );
  }

  console.log('# context-action prompt builders');
  check(
    TranslatePrompt.buildTranslatePrompt(' Hello ', '')
      .includes('Translate the selected text into Hindi.'),
    'translation falls back to Hindi when no target is configured'
  );
  check(
    TranslatePrompt.buildTranslatePrompt('Hello', 'Spanish').
      includes('Translate the selected text into Spanish.'),
    'translation uses the configured target language'
  );
  check(
    DraftPrompt.CONTEXTS.join(',') === 'Email,LinkedIn,Forum',
    'draft picker has exactly the Email, LinkedIn, and Forum contexts'
  );
  const latencyComment = 'Really clever use of MediaPipe. Turning thumb position ' +
    'into reliable button presses is the hard part, and getting it smooth enough ' +
    'for Subway Surfers is impressive. How do you handle latency when ' +
    'recalibrating it for other games?';
  check(
    DraftPrompt.hasExplicitQuestion(latencyComment) &&
      !DraftPrompt.hasExplicitQuestion(
        'Really clever use of MediaPipe. The controls look smooth.'
      ),
    'question detection distinguishes explicit questions from compliments'
  );
  const questionDraftPrompt = DraftPrompt.buildDraftPrompt(
    latencyComment,
    'LinkedIn',
    '',
    'en'
  );
  check(
    questionDraftPrompt.includes('make it the focus of the reply') &&
      questionDraftPrompt.includes('Respond to it directly before addressing any compliment') &&
      questionDraftPrompt.includes('a compliment alone is not an answer') &&
      questionDraftPrompt.includes('Identify whether the message seeks advice') &&
      questionDraftPrompt.includes('Do not merely repeat a question'),
    'explicit questions are addressed directly rather than answered with only a compliment'
  );
  check(
    questionDraftPrompt.includes('Never invent technical details, project experience') &&
      questionDraftPrompt.includes('implementation methods, results, or personal history') &&
      questionDraftPrompt.includes('ask a specific clarification about the missing project detail') &&
      questionDraftPrompt.includes('Do not claim experience you were not given') &&
      questionDraftPrompt.includes('not evidence about the user\'s project') &&
      questionDraftPrompt.includes('Do not infer which option the user chose') &&
      questionDraftPrompt.includes('Do not answer implementation questions by choosing a method') &&
      questionDraftPrompt.includes('claiming "I use" or "we use"'),
    'unknown technical answers invite input without fabricating experience or implementation facts'
  );
  check(
    !/the provided information|the available context|i cannot answer reliably|i am unable to answer/i
      .test(questionDraftPrompt) &&
      questionDraftPrompt.includes('Do not mention being an AI') &&
      questionDraftPrompt.includes('Do not force a greeting or sign-off') &&
      questionDraftPrompt.includes('Never add name placeholders'),
    'prompt prohibits AI-style disclaimers and forced greetings, sign-offs, or placeholders'
  );
  const factSupportedPrompt = DraftPrompt.buildDraftPrompt(
    'How do you make sure each bottle is counted once? Do you trust the tracker ID or use a line-crossing check?',
    'Forum',
    'https://example.test',
    'en',
    { projectFacts: 'The bottle counter uses a line-crossing check to count each bottle once.' }
  );
  check(
    factSupportedPrompt.includes('TRUSTED USER-PROVIDED PROJECT FACTS') &&
      factSupportedPrompt.includes('The bottle counter uses a line-crossing check to count each bottle once.') &&
      factSupportedPrompt.includes('Use only project facts explicitly stated') &&
      factSupportedPrompt.includes('Use a matching fact when it directly answers the selected message') &&
      factSupportedPrompt.includes('omit unrelated facts') &&
      factSupportedPrompt.includes('source website origin are not evidence'),
    'prompt uses directly relevant facts without treating comments or page origin as evidence'
  );
  check(
    questionDraftPrompt.includes('No trusted project facts are supplied') &&
      questionDraftPrompt.includes('The selected text and source website origin are not evidence'),
    'questions listing implementation alternatives do not establish which method the user uses'
  );
  const draftPrompts = DraftPrompt.CONTEXTS.map(function (context) {
    return DraftPrompt.buildDraftPrompt('A supplied comment', context, 'https://example.test', 'en');
  });
  check(
    new Set(draftPrompts).size === 3 &&
      draftPrompts[0].includes('professional, concise email-style prose') &&
      draftPrompts[0].includes('omit a greeting and sign-off for a short technical answer') &&
      draftPrompts[1].includes('one conversational paragraph') &&
      draftPrompts[2].includes('Lead with the direct answer or observation') &&
      draftPrompts[2].includes('do not use report labels or bullets for a short answer'),
    'each draft context has a distinct tone and reply structure'
  );
  const compoundQuestion =
    'What technologies did you use to build your latest project, and what features does it support?';
  const confirmedExtensionFacts =
    'I built a Chrome extension using JavaScript and the Gemini API. ' +
    'It supports page summarisation and selected-text explanations.';
  const compoundPrompts = DraftPrompt.CONTEXTS.map(function (context) {
    return DraftPrompt.buildDraftPrompt(
      compoundQuestion,
      context,
      '',
      'en',
      { projectFacts: confirmedExtensionFacts }
    );
  });
  const compoundReplies = DraftPrompt.CONTEXTS.map(function (context) {
    return DraftPrompt.enforceProjectFacts(
      'That is a useful question. Which constraints matter most in your setup?',
      compoundQuestion,
      context,
      confirmedExtensionFacts,
      'en'
    );
  });
  check(
    compoundPrompts.every(function (prompt) {
      return prompt.includes(compoundQuestion) &&
        prompt.includes(confirmedExtensionFacts) &&
        prompt.includes('For a compound question, answer every explicit part') &&
        prompt.includes('do not replace an answerable part with a generic follow-up');
    }) &&
      compoundReplies[0] ===
        'Thank you for asking.\n\n' +
          'I built a Chrome extension using JavaScript and the Gemini API.\n\n' +
          'It supports page summarisation and selected-text explanations.' &&
      compoundReplies[1] ===
        'Thanks for asking — ' + confirmedExtensionFacts &&
      compoundReplies[2] === confirmedExtensionFacts,
    'all three contexts preserve identical supported facts in distinct email, networking, and forum structures'
  );
  const partialCompoundReply = DraftPrompt.enforceProjectFacts(
    'That is a useful question. Which constraints matter most in your setup?',
    compoundQuestion,
    'Forum',
    'I built a Chrome extension using JavaScript and the Gemini API.',
    'en'
  );
  check(
    partialCompoundReply.includes(
      'I built a Chrome extension using JavaScript and the Gemini API.'
    ) &&
      /Which features does the project support\?/.test(partialCompoundReply) &&
      !/constraints matter most/i.test(partialCompoundReply),
    'partially supplied project facts answer the supported part and clarify the missing feature details'
  );
  const partialFeaturesReply = DraftPrompt.enforceProjectFacts(
    'That is a useful question. Which constraints matter most in your setup?',
    compoundQuestion,
    'LinkedIn',
    'It supports offline reading and selected-text explanations.',
    'en'
  );
  check(
    partialFeaturesReply.includes(
      'It supports offline reading and selected-text explanations.'
    ) &&
      /Which technologies did you use to build the project\?/.test(partialFeaturesReply) &&
      !/constraints matter most/i.test(partialFeaturesReply),
    'partially supplied facts answer the supported feature part and clarify missing technologies'
  );
  const ambassadorMessage =
    'Hey Megha! I recently became a Google Student Ambassador. Could you share ' +
    'any guidance on which activities or contributions helped you most and ' +
    'what I should focus on first?';
  const ambassadorReply = DraftPrompt.enforceProjectFacts(
    'Good question. Curious what you think about it.',
    ambassadorMessage,
    'LinkedIn',
    '',
    'en'
  );
  check(
    ambassadorReply.includes('Hey Megha!') &&
      ambassadorReply.includes('Congratulations on becoming a Google Student Ambassador') &&
      ambassadorReply.includes('Which activities or contributions have been most valuable') &&
      !/Good question|Curious what you think/i.test(ambassadorReply) &&
      !/I recently became|I use|I built|my experience/i.test(ambassadorReply),
    'Google Student Ambassador advice reply recognizes the sender milestone without inventing user experience'
  );
  const ambassadorWithUserFact = DraftPrompt.enforceProjectFacts(
    'Good question. Curious what you think about it.',
    ambassadorMessage,
    'LinkedIn',
    'I recently became a Google Student Ambassador.',
    'en'
  );
  check(
    !/Since I recently became|I led|I organized|I built|I achieved/i
      .test(ambassadorWithUserFact),
    'unrelated personal facts are not forced into an advice reply about the sender'
  );
  const ambassadorFlow = makeRunDeps({
    answer: 'Good question. Curious what you think about it.',
    deps: {
      request: { action: 'draft-reply', text: ambassadorMessage, tabId: 7 },
      projectFacts: ''
    }
  });
  await ContextActions.runContextAction(Object.assign(
    { context: 'LinkedIn' },
    ambassadorFlow.deps
  ));
  check(
    ambassadorFlow.events.includes('provider') &&
      ambassadorFlow.rendered[ambassadorFlow.rendered.length - 1].text
        .includes('Congratulations on becoming a Google Student Ambassador') &&
      ambassadorFlow.rendered[ambassadorFlow.rendered.length - 1].text
        .includes('Which activities or contributions have been most valuable') &&
      !/Good question|Curious what you think/i.test(
        ambassadorFlow.rendered[ambassadorFlow.rendered.length - 1].text
      ),
    'full draft generation flow replaces generic filler with an intent-aware LinkedIn reply'
  );
  const reproductionMessage =
    "Hey Megha! I recently became a Google Student Ambassador and came across your post. " +
    "I wanted to know how you achieved the 'Google knows my name' milestone. " +
    'What activities or contributions are required to reach this level? ' +
    'Would really appreciate your guidance!';
  const inventedExperienceReply =
    'Congratulations on becoming a Google Student Ambassador! To reach that ' +
    'milestone, I focused on leading local tech workshops and engaging actively ' +
    'with the developer community on campus. What kind of events are you ' +
    'planning to host first?';
  const sanitizedReproductionReply = DraftPrompt.enforceProjectFacts(
    inventedExperienceReply,
    reproductionMessage,
    'LinkedIn',
    '',
    'en'
  );
  check(
    DraftPrompt.findUnsupportedPersonalClaims(inventedExperienceReply, '')
      .some(function (claim) {
        return /focused on leading local tech workshops and engaging actively/i.test(claim);
      }) &&
      sanitizedReproductionReply.includes('Congratulations on becoming a Google Student Ambassador') &&
      sanitizedReproductionReply.includes('Which activities or contributions have been most valuable') &&
      !/I focused|I led|I engaged|my experience|I achieved|I hosted/i
        .test(sanitizedReproductionReply) &&
      !/I recently became a Google Student Ambassador/i.test(sanitizedReproductionReply) &&
      !/workshops|developer community on campus|planning to host/i
        .test(sanitizedReproductionReply),
    'exact reproduction rejects invented first-person activities and uses honest general guidance'
  );
  const reproductionFlow = makeRunDeps({
    answer: inventedExperienceReply,
    deps: {
      request: { action: 'draft-reply', text: reproductionMessage, tabId: 7 },
      projectFacts: ''
    }
  });
  await ContextActions.runContextAction(Object.assign(
    { context: 'LinkedIn' },
    reproductionFlow.deps
  ));
  const displayedReproduction =
    reproductionFlow.rendered[reproductionFlow.rendered.length - 1].text;
  check(
    displayedReproduction === sanitizedReproductionReply &&
      !/I focused|I led|I engaged|workshops|developer community on campus|planning to host/i
        .test(displayedReproduction) &&
      reproductionFlow.rendered[reproductionFlow.rendered.length - 1].state === 'ok',
    'draft generation flow validates the exact reproduction before rendering the result'
  );
  const partiallySupportedReply = DraftPrompt.enforceProjectFacts(
    'I recently became a Google Student Ambassador, and I led local tech workshops.',
    reproductionMessage,
    'LinkedIn',
    'I recently became a Google Student Ambassador.',
    'en'
  );
  check(
    !/I led local tech workshops/i.test(partiallySupportedReply) &&
      !/I recently became a Google Student Ambassador/i.test(partiallySupportedReply),
    'a partly supported sentence is replaced instead of trusting a matching substring'
  );
  check(
    DraftPrompt.findUnsupportedPersonalClaims(
      'I recently became a Google Student Ambassador.',
      'I recently became a Google Student Ambassador.'
    ).length === 0 &&
      DraftPrompt.findUnsupportedPersonalClaims(
        "I've led campus workshops and expanded student participation.",
        ''
      ).length === 1,
    'validator accepts a directly supplied claim and detects contracted first-person achievements'
  );
  check(
    DraftPrompt.classifyIntent(ambassadorMessage).type === 'advice' &&
      DraftPrompt.classifyIntent('I recently won a research fellowship.')
        .type === 'achievement' &&
      DraftPrompt.classifyIntent(
        'How do you handle landmark variation and wrist rotation?'
      ).type === 'technical-question' &&
      DraftPrompt.classifyIntent('The new release makes setup much easier.')
        .type === 'discussion',
    'intent detection distinguishes advice, achievements, technical questions, and general discussion'
  );
  const statementOnlyPrompt = DraftPrompt.buildDraftPrompt(
    'The thumb controls feel smooth in Subway Surfers.',
    'LinkedIn',
    '',
    'en'
  );
  check(
    !DraftPrompt.hasExplicitQuestion('The thumb controls feel smooth in Subway Surfers.') &&
      statementOnlyPrompt.includes('For a statement without a question') &&
      statementOnlyPrompt.includes('brief, relevant reaction or contribution') &&
      statementOnlyPrompt.includes('rather than restating it'),
    'statements without questions get a concise, relevant response instead of a paraphrase'
  );
  check(
    DraftPrompt.buildDraftPrompt('A comment', 'LinkedIn', '<html>never supplied</html>', 'en')
      .includes('<html>') === false &&
      DraftPrompt.buildDraftPrompt(
        'A comment',
        'LinkedIn',
        'https://example.test/private/path?token=value',
        'en'
      ).includes('https://example.test'),
    'draft page context is restricted to an HTTP(S) origin, never raw page HTML or URL details'
  );
  check(
    TranslatePrompt.buildTranslatePrompt(' \n ', 'Spanish') === '' &&
      DraftPrompt.buildDraftPrompt('', 'Email', '', 'en') === '',
      'prompt builders refuse empty selections'
  );

  console.log('# code-enforced trusted-facts protection');
  {
    const bottleQuestion =
      'Checking cap color on top of cap presence is a smart extra. ' +
      'How do you make sure each bottle is counted once when two touch on the belt? ' +
      'Do you trust the tracker ID or use a line-crossing check?';
    const mediaPipeQuestion =
      'MediaPipe returns 1 landmark in one case and 7 in another. ' +
      'How do you handle the variation? What angle threshold or wrist rotation ' +
      'do you use? Does it require training data?';
    const hallucinations = [
      'Thank you for asking. We usually rely on a line-crossing detection zone to count bottles.',
      'I usually lean toward a line-crossing check because it keeps the count accurate.',
      'A well-timed line-crossing gate usually provides a cleaner count.'
    ];

    for (let i = 0; i < DraftPrompt.CONTEXTS.length; i += 1) {
      const context = DraftPrompt.CONTEXTS[i];
      const generated = makeRunDeps({
        answer: hallucinations[i],
        deps: {
          request: { action: 'draft-reply', text: bottleQuestion, tabId: 7 }
        }
      });
      await ContextActions.runContextAction(Object.assign(
        { context: context },
        generated.deps
      ));
      const output = generated.rendered[generated.rendered.length - 1].text;
      check(
        generated.events.includes('provider') &&
          !/tracker[\s-]*ids?|line[\s-]*cross(?:ing|ed|es)?|unique[\s-]+ids?[\s-]+persistence/i
            .test(output) &&
          !/\b(?:i|we)\s+(?:usually\s+)?(?:use|rely|trust|lean toward)\b/i.test(output) &&
          /Could you share how you make sure each bottle is counted once/i.test(output) &&
          output !== hallucinations[i],
        context + ' overrides unsupported provider claims with a question-specific safe draft'
      );
    }

    const mediaPipeHallucinations = [
      'We set the orientation threshold during landmark extraction.',
      'I compensate for wrist rotation using an angle threshold.',
      'This requires training data for all 7 landmarks.'
    ];
    for (let i = 0; i < DraftPrompt.CONTEXTS.length; i += 1) {
      const context = DraftPrompt.CONTEXTS[i];
      const generated = makeRunDeps({
        answer: mediaPipeHallucinations[i],
        deps: {
          request: { action: 'draft-reply', text: mediaPipeQuestion, tabId: 7 }
        }
      });
      await ContextActions.runContextAction(Object.assign(
        { context: context },
        generated.deps
      ));
      const output = generated.rendered[generated.rendered.length - 1].text;
      check(
        DraftPrompt.isImplementationQuestion(mediaPipeQuestion) &&
          !/orientation threshold|wrist rotation|training data/i.test(output) &&
          /Could you share how you handle the variation/i.test(output) &&
          output !== mediaPipeHallucinations[i],
        context + ' does not turn the MediaPipe 1-versus-7 question into an unsupported technical claim'
      );
    }

    check(
      DraftPrompt.isImplementationQuestion(bottleQuestion) &&
        DraftPrompt.getSupportedImplementationFact(
          bottleQuestion,
          'We use a line-crossing check to count each bottle once.'
        ) === 'We use a line-crossing check to count each bottle once.',
      'implementation questions use only matching, explicitly affirmed facts'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        bottleQuestion,
        'We use React for the dashboard.'
      ) === '',
      'unrelated supplied facts do not authorize an implementation answer'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        bottleQuestion,
        'We use a new belt.'
      ) === '',
      'one incidental shared word does not make supplied facts relevant'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        'How do you recover failed jobs in the deployment pipeline?',
        'We process failed jobs in the deployment pipeline dashboard.'
      ) === '',
      'several shared keywords do not make an unrelated pipeline fact answer the question'
    );
    const confirmedExtensionFacts =
      'I built a Chrome extension using JavaScript and the Gemini API. ' +
      'It supports page summarisation and selected-text explanations.';
    const technologyQuestion =
      'Nice implementation. What technology did you use in your project?';
    check(
      DraftPrompt.isImplementationQuestion(technologyQuestion) &&
        DraftPrompt.getSupportedImplementationFact(
          technologyQuestion,
          confirmedExtensionFacts
        ) === 'I built a Chrome extension using JavaScript and the Gemini API.',
      'a technology question selects only the matching confirmed project fact'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        'What features does your extension support?',
        confirmedExtensionFacts
      ) === 'It supports page summarisation and selected-text explanations.',
      'a feature question selects the matching confirmed capability statement'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        'What technologies did you use to build your project?',
        'I use Python for personal scripts.'
      ) === '' &&
        DraftPrompt.getSupportedImplementationFact(
          'What features does your extension support?',
          'The team supports accessibility research.'
        ) === '',
      'personal tool use and unrelated capabilities are not treated as project facts'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        'How does your extension handle reliability?',
        confirmedExtensionFacts
      ) === '',
      'one incidental shared word does not make a technology fact answer an unrelated implementation question'
    );
    const technologyReply = DraftPrompt.enforceProjectFacts(
      'We used Python, Firebase, and a custom ranking model.',
      technologyQuestion,
      'LinkedIn',
      confirmedExtensionFacts,
      'en'
    );
    check(
      technologyReply ===
        'Thanks for the kind words — I built a Chrome extension using JavaScript and the Gemini API.' &&
        !/Python|Firebase|ranking model|page summarisation/i.test(technologyReply),
      'directly relevant facts replace unsupported model claims without adding unrelated facts'
    );
    const uncoveredTechnicalQuestion =
      'Your implementation is impressive. How does your project handle model failover?';
    const uncoveredReply = DraftPrompt.enforceProjectFacts(
      'The extension supports offline mode and retries every request three times.',
      uncoveredTechnicalQuestion,
      'LinkedIn',
      confirmedExtensionFacts,
      'en'
    );
    check(
      !/offline mode|three times|JavaScript|Gemini API/i.test(uncoveredReply) &&
        /Could you clarify this project detail: How does your project handle model failover\?/i
          .test(uncoveredReply),
      'a technical question not covered by the facts gets a useful clarification, not an invented answer'
    );
    const unrelatedReply = DraftPrompt.enforceProjectFacts(
      'I built a Chrome extension using JavaScript and the Gemini API.',
      'The new release makes setup easier for first-time users.',
      'LinkedIn',
      confirmedExtensionFacts,
      'en'
    );
    check(
      !/Chrome extension|JavaScript|Gemini API/i.test(unrelatedReply) &&
        /useful takeaway/i.test(unrelatedReply),
      'even an exact supplied fact is not forced into an unrelated discussion'
    );
    check(
      DraftPrompt.findUnsupportedPersonalClaims(
        'I built a Chrome extension using JavaScript and the Gemini API, and it supports offline mode.',
        confirmedExtensionFacts,
        technologyQuestion
      ).length > 0 &&
        DraftPrompt.findUnsupportedPersonalClaims(
          'The extension supports offline mode for 10,000 users.',
          '',
          'The new release is easier to set up.'
        ).length > 0 &&
        DraftPrompt.findUnsupportedPersonalClaims(
          'The extension reached 100,000 users.',
          '',
          'The new release is easier to set up.'
        ).length > 0,
      'validator rejects embellished personal claims, unsupported project details, and invented metrics'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        bottleQuestion,
        'We use optical flow to count bottles that touch on the belt.'
      ) === 'We use optical flow to count bottles that touch on the belt.',
      'relevant user-provided facts can support a method not named in the question'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        mediaPipeQuestion,
        'We set the orientation threshold during landmark extraction.'
      ) === 'We set the orientation threshold during landmark extraction.',
      'explicitly entered MediaPipe facts may support the matching technical answer'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        mediaPipeQuestion,
        'We do not set an orientation threshold.'
      ) === '',
      'negated project facts cannot be presented as affirmative implementation claims'
    );
    check(
      DraftPrompt.getSupportedImplementationFact(
        mediaPipeQuestion,
        'We use no orientation threshold.'
      ) === '',
      'a fact that negates a method after its action is not accepted'
    );
    const emptyFactsTechnicalReply = DraftPrompt.enforceProjectFacts(
      'I implemented a tracker ID and have extensive experience with it.',
      bottleQuestion,
      'LinkedIn',
      '',
      'en'
    );
    check(
      !/\b(?:i|we)\b.{0,60}\b(?:implemented|experience|use|rely|trust)\b/i
        .test(emptyFactsTechnicalReply) &&
        !/tracker[\s-]*ids?|line[\s-]*cross(?:ing|ed|es)?|unique[\s-]+ids?[\s-]+persistence/i
          .test(emptyFactsTechnicalReply) &&
        /Could you share how you make sure each bottle is counted once/i
          .test(emptyFactsTechnicalReply),
      'empty project facts remove personal implementation and experience claims'
    );
    check(
      DraftPrompt.enforceProjectFacts(
        'We trust tracker IDs and save every unique ID.',
        bottleQuestion,
        'Forum',
        'We use a line-crossing check.',
        'en'
      ) === 'We use a line-crossing check.',
      'a supplied fact supports only the stated method, not unsupported model claims'
    );

    const suppliedFactReply = DraftPrompt.enforceProjectFacts(
      'We use a line-crossing check, save every tracker ID, and achieved perfect accuracy.',
      bottleQuestion,
      'LinkedIn',
      'We use a line-crossing check.',
      'en'
    );
    check(
      suppliedFactReply === 'Thanks for asking — We use a line-crossing check.' &&
        !/save every tracker ID|perfect accuracy/i.test(suppliedFactReply),
      'the generated draft cannot embellish a supplied implementation fact'
    );

    const adviceReply = DraftPrompt.enforceProjectFacts(
      'Good question. Curious what you think about it.',
      'Could you share advice on getting started and which first steps matter most?',
      'LinkedIn',
      '',
      'en'
    );
    const generalDiscussionReply = DraftPrompt.enforceProjectFacts(
      'I led a team that shipped this feature.',
      'The new release makes setup much easier for first-time users.',
      'Forum',
      '',
      'en'
    );
    const linkedInDiscussionReply = DraftPrompt.enforceProjectFacts(
      'Good question. Curious what you think about it.',
      'The new release makes setup much easier for first-time users.',
      'LinkedIn',
      '',
      'en'
    );
    const emailAdviceReply = DraftPrompt.enforceProjectFacts(
      'I led a team that improved onboarding.',
      'Could you share advice on getting started?',
      'Email',
      '',
      'en'
    );
    check(
      /first steps would you recommend/i.test(adviceReply) &&
        !/Good question|Curious what you think/i.test(adviceReply) &&
        /useful takeaway/i.test(generalDiscussionReply) &&
        /Thanks for sharing this perspective/i.test(linkedInDiscussionReply) &&
        !/Thanks for sharing/i.test(generalDiscussionReply) &&
        !/I led a team/i.test(generalDiscussionReply) &&
        /^Thank you for sharing your perspective\./.test(emailAdviceReply) &&
        !/^Hello,/.test(emailAdviceReply) &&
        !/Best regards,$/.test(emailAdviceReply),
      'advice and general discussion get context-appropriate replies without forced email salutations'
    );

    const trusted = 'We use a line-crossing check to count each bottle once.';
    const factBacked = makeRunDeps({
      answer: 'We trust tracker IDs and save every unique ID.',
      deps: {
        request: { action: 'draft-reply', text: bottleQuestion, tabId: 7 },
        projectFacts: trusted
      }
    });
    await ContextActions.runContextAction(Object.assign(
      { context: 'Forum' },
      factBacked.deps
    ));
    check(
      factBacked.rendered[factBacked.rendered.length - 1].text === trusted &&
        factBacked.events.includes('provider'),
      'a relevant explicitly supplied fact is used instead of conflicting generated claims'
    );

    const classificationOrder = [];
    const guardedFacts = makeRunDeps({
      deps: {
        request: { action: 'draft-reply', text: bottleQuestion, tabId: 7 },
        projectFacts: trusted,
        classifier: {
          classifyText: function (value) {
            classificationOrder.push(value);
            return { class: 'ordinary' };
          }
        }
      }
    });
    await ContextActions.runContextAction(Object.assign(
      { context: 'Forum' },
      guardedFacts.deps
    ));
    check(
      classificationOrder.includes(bottleQuestion) &&
        classificationOrder.includes(trusted) &&
        guardedFacts.events.indexOf('guard') < guardedFacts.events.indexOf('provider'),
      'selected comment and explicitly supplied facts remain safety-checked before provider invocation'
    );
  }

  console.log('\n# translation-target preference');
  {
    const stored = {};
    const manager = {
      storageGet: function (path) { return Promise.resolve(stored[path]); },
      storageSet: function (path, value) {
        stored[path] = value;
        return Promise.resolve();
      }
    };
    check(
      await Preferences.getTranslationTargetLanguage(manager) === '',
      'unset translation target remains unconfigured for Hindi fallback'
    );
    await Preferences.setTranslationTargetLanguage(manager, 'sPaNiSh');
    check(
      await Preferences.getTranslationTargetLanguage(manager) === 'Spanish',
      'translation target preference persists and normalizes'
    );
    await Preferences.setTranslationTargetLanguage(manager, 'unsupported');
    check(
      await Preferences.getTranslationTargetLanguage(manager) === '',
      'invalid stored targets normalize to the Hindi fallback'
    );
  }

  console.log('\n# context-action safety and provider orchestration');
  {
    const empty = makeRunDeps();
    empty.deps.request.text = '  ';
    await ContextActions.runContextAction(empty.deps);
    check(
      empty.events.length === 0 &&
        empty.rendered[0].state === 'error' &&
        /Select some text/.test(empty.rendered[0].message),
      'empty selection is refused before safety, key access, and provider invocation'
    );
  }

  {
    let prompt = '';
    const successful = makeRunDeps({
      targetLanguage: 'Spanish',
      onCallAI: function (call) { prompt = call.prompt; },
      deps: { language: 'hinglish' }
    });
    await ContextActions.runContextAction(successful.deps);
    check(
      successful.events.indexOf('guard') !== -1 &&
        successful.events.indexOf('guard') < successful.events.indexOf('get-key') &&
        successful.events.indexOf('get-key') < successful.events.indexOf('provider'),
      'read-safety gate runs before key retrieval and provider invocation'
    );
    check(
      prompt.includes('Translate the selected text into Spanish.') &&
        !prompt.includes('Hinglish') &&
        !prompt.includes('/private/path') &&
        !prompt.includes('token=not-for-provider'),
      'translation uses its independent target preference without adding response-language instructions or the full URL'
    );
    check(
      successful.rendered[successful.rendered.length - 1].text === 'Generated result.',
      'translation result renders successfully'
    );
  }

  {
    let prompt = '';
    const defaultLanguage = makeRunDeps({
      onCallAI: function (call) { prompt = call.prompt; }
    });
    await ContextActions.runContextAction(defaultLanguage.deps);
    check(
      prompt.includes('Translate the selected text into Hindi.'),
      'an unset translation target defaults to Hindi in the full action flow'
    );
  }

  {
    const blocked = makeRunDeps({ allowed: false });
    await ContextActions.runContextAction(blocked.deps);
    check(
      blocked.events.includes('guard') &&
        !blocked.events.includes('get-key') &&
        !blocked.events.includes('provider') &&
        blocked.rendered[blocked.rendered.length - 1].state === 'error',
      'blocked page stops before key retrieval and provider invocation'
    );
  }

  {
    const missingKey = makeRunDeps({
      deps: {
        getKey: function () { return Promise.resolve(''); }
      }
    });
    await ContextActions.runContextAction(missingKey.deps);
    check(
      !missingKey.events.includes('provider') &&
        /Gemini API key/.test(
          missingKey.rendered[missingKey.rendered.length - 1].message
        ),
      'missing API key produces a visible message without calling the provider'
    );
  }

  {
    const providerFailure = makeRunDeps({
      deps: {
        callAI: function () { return Promise.reject(new Error('network down')); }
      }
    });
    await ContextActions.runContextAction(providerFailure.deps);
    check(
      /could not generate/.test(
        providerFailure.rendered[providerFailure.rendered.length - 1].message
      ),
      'provider rejection renders an explicit failure'
    );
  }

  {
    const emptyResult = makeRunDeps({
      deps: {
        callAI: function () { return Promise.resolve({ ok: true, text: '' }); }
      }
    });
    await ContextActions.runContextAction(emptyResult.deps);
    check(
      emptyResult.rendered[emptyResult.rendered.length - 1].state === 'error',
      'empty AI response renders an explicit failure'
    );
  }

  console.log('\n# panel context-action rendering');
  {
    const elements = {
      'draft-context-picker': { hidden: true },
      'context-action-result': { textContent: '', className: '' },
      'context-action-text': { textContent: '' },
      'context-action-copy-selection': {
        hidden: true,
        addEventListener: function (type, listener) {
          if (type === 'click') copySelection = listener;
        }
      },
      'context-action-copy-result': {
        hidden: true,
        addEventListener: function (type, listener) {
          if (type === 'click') copyResult = listener;
        }
      },
      'context-action-copy-status': { textContent: '' },
      'draft-project-facts': {
        value: '',
        hidden: false,
        disabled: false,
        readOnly: false
      }
    };
    const buttonListeners = {};
    const pressedStates = {};
    let copySelection;
    let copyResult;
    const clipboardWrites = [];
    const buttons = DraftPrompt.CONTEXTS.map(function (context) {
      return {
        addEventListener: function (type, listener) { buttonListeners[context] = listener; },
        getAttribute: function () { return context; },
        setAttribute: function (name, value) {
          if (name === 'aria-pressed') pressedStates[context] = value;
        }
      };
    });
    const calls = [];
    const geminiRequests = [];
    const storageWrites = [];
    const draftBuilderArguments = [];
    let providerResponse = '';
    const panelDraftPrompt = Object.assign({}, DraftPrompt, {
      buildDraftPrompt: function () {
        const args = Array.prototype.slice.call(arguments);
        draftBuilderArguments.push(args);
        return DraftPrompt.buildDraftPrompt.apply(null, args);
      }
    });
    const win = {
      document: {
        readyState: 'complete',
        getElementById: function (id) { return elements[id]; },
        querySelectorAll: function () { return buttons; }
      },
      navigator: {
        clipboard: {
          writeText: function (text) {
            clipboardWrites.push(text);
            return Promise.resolve();
          }
        }
      },
      SahayakDraftPrompt: panelDraftPrompt,
      SahayakTranslatePrompt: TranslatePrompt,
      SahayakSafetyClassifiers: {
        classifyText: function () { return { class: 'ordinary' }; }
      },
      SahayakPreferences: {
        getTranslationTargetLanguage: function () { return Promise.resolve('French'); }
      },
      SahayakLanguage: { current: function () { return 'en'; } },
      SahayakStorageManager: {
        storageSet: function (key, value) {
          storageWrites.push({ key: key, value: value });
          return Promise.resolve();
        }
      },
      SahayakApiKeys: {
        getGeminiKey: function () { return Promise.resolve('test-key'); }
      },
      SahayakExplain: {
        explainSelection: function (opts) {
          calls.push(opts);
          return Explain.explainSelection({
            key: opts.key,
            prompt: opts.prompt,
            fetchImpl: function (_url, request) {
              geminiRequests.push(JSON.parse(request.body));
              return Promise.resolve({
                status: 200,
                ok: true,
                json: function () {
                  return Promise.resolve({
                    candidates: [{
                      content: {
                        parts: [{ text: providerResponse || 'Rendered ' + calls.length }]
                      }
                    }]
                  });
                }
              });
            }
          });
        }
      },
      SahayakPanel: {
        requestPageInfo: function () {
          return Promise.resolve({ url: 'https://example.test/path' });
        },
        guardRead: function () { return Promise.resolve({ allowed: true }); }
      }
    };
    ContextActions.initUI(win);
    const workflow = win.SahayakContextActionWorkflow;
    await workflow.receive({ action: 'translate', text: 'Translate me', tabId: 7 });
    check(
      elements['context-action-result'].textContent === 'Rendered 1' &&
        calls[0].prompt.includes('Translate the selected text into French.') &&
        elements['context-action-text'].textContent === 'Translate me' &&
        !elements['context-action-copy-selection'].hidden &&
        !elements['context-action-copy-result'].hidden,
      'Translate shows the full selection and provides copy controls for selection and result'
    );
    await copySelection();
    await copyResult();
    check(
      clipboardWrites[0] === 'Translate me' &&
        clipboardWrites[1] === 'Rendered 1',
      'copy controls copy the exact selected text and generated response'
    );
    let panelCopyPreservedSelections = true;
    for (let i = 0; i < selectionTextCases.length; i += 1) {
      const selectedText = selectionTextCases[i];
      const request = ContextAction.createRequest(
        'sahayak-context-draft-reply',
        selectedText,
        { id: 7, url: 'https://example.test/path' },
        '',
        'copy-selection-' + i
      );
      await workflow.receive(request);
      await copySelection();
      panelCopyPreservedSelections = panelCopyPreservedSelections &&
        elements['context-action-text'].textContent === selectedText &&
        clipboardWrites[clipboardWrites.length - 1] === selectedText;
    }
    check(
      panelCopyPreservedSelections,
      'captured selected text is displayed and copied byte-for-byte, including punctuation, spacing, newlines, and Unicode'
    );
    check(
      ContextAction.createRequest(
        'sahayak-context-draft-reply',
        '',
        { id: 7, url: 'https://example.test/path' },
        '',
        'empty-selection'
      ) === null,
      'an empty selected-text string is rejected'
    );

    await workflow.receive({ action: 'draft-reply', text: 'Reply to this', tabId: 7 });
    check(
      elements['draft-context-picker'].hidden === false &&
        elements['draft-project-facts'].hidden === false &&
        elements['draft-project-facts'].disabled === false &&
        elements['draft-project-facts'].readOnly === false &&
        calls.length === 1 &&
        elements['context-action-text'].textContent === 'Reply to this' &&
        elements['context-action-copy-result'].hidden &&
        DraftPrompt.CONTEXTS.every(function (context) {
          return pressedStates[context] === 'false';
        }),
      'draft action shows the context picker without generating a draft'
    );

    const projectFacts =
      'I built a Chrome extension using JavaScript and the Gemini API. ' +
      'It supports page summarisation and selected-text explanations.';
    elements['draft-project-facts'].value = projectFacts;
    for (let i = 0; i < DraftPrompt.CONTEXTS.length; i += 1) {
      const context = DraftPrompt.CONTEXTS[i];
      await buttonListeners[context]();
      const prompt = calls[calls.length - 1].prompt;
      check(
        prompt.includes('in the ' + context + ' conversation') &&
          prompt.includes('https://example.test') &&
          prompt.includes(projectFacts) &&
          draftBuilderArguments[draftBuilderArguments.length - 1][4].projectFacts ===
            projectFacts &&
          elements['draft-project-facts'].value === projectFacts &&
          !prompt.includes('/path') &&
          DraftPrompt.CONTEXTS.every(function (option) {
            return pressedStates[option] === (option === context ? 'true' : 'false');
          }) &&
          elements['context-action-result'].textContent ===
            DraftPrompt.enforceProjectFacts(
              'Rendered ' + calls.length,
              'Reply to this',
              context,
              projectFacts,
              'en'
            ),
        context + ' click passes the current textarea value as projectFacts and renders its draft'
      );
    }
    await copyResult();
    check(
      clipboardWrites[clipboardWrites.length - 1] === 'Rendered 4',
      'generated draft remains copyable inside the side panel'
    );

    const exactDraftRequest = ContextAction.createRequest(
      'sahayak-context-draft-reply',
      selectionTextCases[1],
      { id: 7, url: 'https://example.test/path' },
      '',
      'exact-draft-selection'
    );
    await workflow.receive(exactDraftRequest);
    check(
      elements['draft-project-facts'].value === projectFacts,
      'receiving a new selection does not discard the current facts before the user can review or replace them'
    );
    elements['draft-project-facts'].value = projectFacts;
    providerResponse =
      'That is a useful question. Which constraints matter most in your setup?';
    for (let i = 0; i < DraftPrompt.CONTEXTS.length; i += 1) {
      const context = DraftPrompt.CONTEXTS[i];
      await buttonListeners[context]();
      const call = calls[calls.length - 1];
      const geminiPrompt =
        geminiRequests[geminiRequests.length - 1].contents[0].parts[0].text;
      const visibleReply = elements['context-action-result'].textContent;
      check(
        call.prompt === geminiPrompt &&
          geminiPrompt.includes(
            'SELECTED TEXT:\n"""\n' + selectionTextCases[1] + '\n"""'
          ) &&
          geminiPrompt.includes(
            'TRUSTED USER-PROVIDED PROJECT FACTS:\n"""\n' +
              projectFacts + '\n"""'
          ) &&
          draftBuilderArguments[draftBuilderArguments.length - 1][4].projectFacts ===
            projectFacts &&
          elements['draft-project-facts'].value === projectFacts &&
          visibleReply.includes('I built a Chrome extension using JavaScript and the Gemini API.') &&
          visibleReply.includes('It supports page summarisation and selected-text explanations.') &&
          !/constraints matter most|useful question/i.test(visibleReply),
        context + ' sends exact supplied facts in the final Gemini request and displays both supported answers'
      );
    }
    const formattedProjectFacts = '\n' + projectFacts + '\n';
    elements['draft-project-facts'].value = formattedProjectFacts;
    await buttonListeners.Email();
    const formattedGeminiPrompt =
      geminiRequests[geminiRequests.length - 1].contents[0].parts[0].text;
    check(
      draftBuilderArguments[draftBuilderArguments.length - 1][4].projectFacts ===
        formattedProjectFacts &&
        formattedGeminiPrompt.includes(
          'TRUSTED USER-PROVIDED PROJECT FACTS:\n"""\n' +
            formattedProjectFacts + '\n"""'
        ) &&
        elements['draft-project-facts'].value === formattedProjectFacts,
      'textarea contents, including pasted whitespace, are captured and passed to the prompt without trimming or clearing'
    );
    const finalCompoundReply = elements['context-action-result'].textContent;
    await copyResult();
    check(
      clipboardWrites[clipboardWrites.length - 1] === finalCompoundReply &&
        finalCompoundReply.includes('I built a Chrome extension using JavaScript and the Gemini API.') &&
        finalCompoundReply.includes('It supports page summarisation and selected-text explanations.'),
      'Copy returns the relevant compound-question answer with both confirmed facts'
    );

    const chatSource = fs.readFileSync(
      path.join(__dirname, '../../panel/features/chat.js'),
      'utf8'
    );
    const sessionStoreSource = fs.readFileSync(
      path.join(__dirname, '../../state/session-store.js'),
      'utf8'
    );
    const contextActionsSource = fs.readFileSync(
      path.join(__dirname, '../../panel/features/context-actions.js'),
      'utf8'
    );
    check(
      !/draft-project-facts|projectFacts/.test(chatSource) &&
        !/draft-project-facts|projectFacts/.test(sessionStoreSource) &&
        !/getElementById\(['"]chat-question['"]\)/.test(contextActionsSource) &&
        !/sessionStore|addMessage/.test(contextActionsSource),
      'draft facts have no Page Chat or session-history handoff'
    );

    const trustedFacts = 'We use a line-crossing check to count each bottle once.';
    elements['draft-project-facts'].value = trustedFacts;
    await buttonListeners.Email();
    check(
      calls[calls.length - 1].prompt.includes(
        'SELECTED TEXT:\n"""\n' + selectionTextCases[1] + '\n"""'
      ) &&
        calls[calls.length - 1].prompt.includes(
          'TRUSTED USER-PROVIDED PROJECT FACTS:\n"""\n' +
          trustedFacts + '\n"""'
        ) &&
        draftBuilderArguments[draftBuilderArguments.length - 1][4].projectFacts ===
          trustedFacts &&
        storageWrites.length === 0,
      'entered facts reach the generator separately from selected text and trigger no storage writes'
    );

    await workflow.receive({
      action: 'draft-reply',
      text: 'Start a new draft',
      tabId: 7
    });
    check(
      elements['draft-project-facts'].value === trustedFacts,
      'receiving another selection retains facts for review instead of silently clearing the textarea'
    );

    const confirmedExtensionFacts =
      'I built a Chrome extension using JavaScript and the Gemini API. ' +
      'It supports page summarisation and selected-text explanations.';
    await workflow.receive({
      action: 'draft-reply',
      text: 'Nice implementation. What technology did you use in your project?',
      tabId: 7
    });
    elements['draft-project-facts'].value = confirmedExtensionFacts;
    providerResponse = 'The extension supports offline mode for 10,000 users.';
    await buttonListeners.LinkedIn();
    const validatedDraft =
      'Thanks for the kind words — I built a Chrome extension using JavaScript and the Gemini API.';
    check(
      elements['context-action-result'].textContent === validatedDraft,
      'the final visible draft replaces unsupported provider claims with the relevant confirmed fact'
    );
    await copyResult();
    check(
      clipboardWrites[clipboardWrites.length - 1] === validatedDraft,
      'Copy returns the validated draft, never the unfiltered provider response'
    );

    check(
      !calls.some(function (call) {
        return Object.keys(call).some(function (key) {
          return /tab|sendMessage|submit|post/i.test(key);
        });
      }),
      'draft provider requests contain no website submission or posting action'
    );
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
