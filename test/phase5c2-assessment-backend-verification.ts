import assert from 'node:assert/strict';
import { gradeObjectiveQuestion, studentSafeQuestion, validateQuestion } from '../server/src/services/assessmentValidation.js';

const base = { questionText: 'Select an answer', marks: 2, options: [] as Array<{ optionText: string; isCorrect?: boolean }> };
assert.equal(validateQuestion({ ...base, questionType: 'mcq', options: [{ optionText: 'A', isCorrect: true }, { optionText: 'B' }] }), null);
assert.match(validateQuestion({ ...base, questionType: 'mcq', options: [{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: true }] }) || '', /exactly one/);
assert.equal(validateQuestion({ ...base, questionType: 'multiple_select', options: [{ optionText: 'A', isCorrect: true }, { optionText: 'B', isCorrect: true }] }), null);
assert.match(validateQuestion({ ...base, questionType: 'multiple_select', options: [{ optionText: 'A' }, { optionText: 'B' }] }) || '', /one or more/);
assert.equal(validateQuestion({ ...base, questionType: 'true_false', options: [{ optionText: 'True', isCorrect: true }, { optionText: 'False' }] }), null);
assert.equal(validateQuestion({ ...base, questionType: 'descriptive' }), null);
assert.equal(gradeObjectiveQuestion('multiple_select', 2, ['a', 'b'], ['b', 'a']), 2);
assert.equal(gradeObjectiveQuestion('multiple_select', 2, ['a', 'b'], ['a']), 0);
assert.equal(gradeObjectiveQuestion('mcq', 2, ['a'], ['b']), 0);

const safe = studentSafeQuestion({ id: 'q', questionOrder: 1, questionType: 'mcq', questionText: 'Q', marks: 1,
  options: [{ id: 'secret-option', questionId: 'q', optionOrder: 1, optionText: 'A', isCorrect: true }] });
assert.deepEqual(safe.options[0], { id: 'secret-option', questionId: 'q', optionOrder: 1, optionText: 'A' });
assert.equal(JSON.stringify(safe).includes('isCorrect'), false);
console.log('Phase 5C.2 assessment backend validation checks passed.');
