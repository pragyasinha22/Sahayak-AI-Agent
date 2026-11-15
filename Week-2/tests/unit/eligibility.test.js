'use strict';

const assert = require('node:assert/strict');
const Eligibility = require('../../providers/eligibility.js');

let passed = 0;
let failed = 0;

function check(condition, message) {
  try {
    assert.ok(condition, message);
    passed += 1;
    console.log('  ✓ ' + message);
  } catch (error) {
    failed += 1;
    console.error('  ✗ ' + message);
    console.error(error.message);
  }
}

function main() {
  console.log('# documented Groq-eligible task types');
  for (const taskType of [
    'page-chat',
    'translation',
    'draft-reply',
    'text-summary',
    'json-action-selection',
  ]) {
    check(
      Eligibility.isEligible({ taskType, prompt: 'A text-only prompt.' }),
      'allows documented text task type ' + taskType
    );
  }

  console.log('\n# ineligible and malformed tasks');
  for (const task of [
    { taskType: 'explain', prompt: 'Explain selected text.' },
    { taskType: 'unknown', prompt: 'Unknown task.' },
    { taskType: 'page-chat', prompt: 'Question.', image: undefined },
    { taskType: 'text-summary', prompt: 'Visual analysis.', requiresVision: true },
    { taskType: 'translation', prompt: '   ' },
    null,
  ]) {
    check(!Eligibility.isEligible(task), 'rejects ineligible task ' + JSON.stringify(task));
  }

  let thrown;
  try {
    Eligibility.assertEligible({
      taskType: 'page-chat',
      prompt: 'Question.',
      image: 'data:image/png;base64,abc',
    });
  } catch (error) {
    thrown = error;
  }
  check(
    thrown instanceof Eligibility.IneligibleTaskError &&
      thrown.code === 'ineligible-task' &&
      thrown.message === Eligibility.INELIGIBLE_TASK_MESSAGE,
    'throws IneligibleTaskError before an image task can reach Groq'
  );

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main();
