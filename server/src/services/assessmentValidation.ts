export type AssessmentQuestionType = 'mcq' | 'multiple_select' | 'true_false' | 'descriptive';

export interface QuestionOptionInput {
  optionText: string;
  optionOrder?: number;
  isCorrect?: boolean;
}

export interface QuestionInput {
  questionType: AssessmentQuestionType;
  questionText: string;
  marks: number;
  options: QuestionOptionInput[];
}

export function validateQuestion(input: QuestionInput): string | null {
  if (!['mcq', 'multiple_select', 'true_false', 'descriptive'].includes(input.questionType)) return 'Unsupported question type.';
  if (!input.questionText?.trim()) return 'Question text is required.';
  if (!Number.isFinite(Number(input.marks)) || Number(input.marks) <= 0) return 'Question marks must be greater than zero.';
  if (!Array.isArray(input.options)) return 'Options must be an array.';
  if (input.options.some((option) => !option.optionText?.trim())) return 'Every option needs text.';

  const correct = input.options.filter((option) => option.isCorrect === true).length;
  if (input.questionType === 'mcq' && (input.options.length < 2 || correct !== 1)) return 'MCQ requires at least two options and exactly one correct option.';
  if (input.questionType === 'multiple_select' && (input.options.length < 2 || correct < 1)) return 'Multiple-select requires at least two options and one or more correct options.';
  if (input.questionType === 'true_false') {
    const labels = input.options.map((option) => option.optionText.trim().toLocaleLowerCase()).sort();
    if (labels.length !== 2 || labels[0] !== 'false' || labels[1] !== 'true' || correct !== 1) return 'True/False requires the fixed True and False options and exactly one correct answer.';
  }
  if (input.questionType === 'descriptive' && input.options.length !== 0) return 'Descriptive questions cannot have options.';
  return null;
}

export function gradeObjectiveQuestion(type: AssessmentQuestionType, marks: number, correctOptionIds: string[], selectedOptionIds: string[]): number {
  if (type === 'descriptive' || correctOptionIds.length === 0) return 0;
  const correct = [...new Set(correctOptionIds)].sort();
  const selected = [...new Set(selectedOptionIds)].sort();
  const exact = correct.length === selected.length && correct.every((id, index) => id === selected[index]);
  return exact ? marks : 0;
}

export function studentSafeQuestion(question: any) {
  return {
    id: question.id,
    questionOrder: question.questionOrder,
    questionType: question.questionType,
    questionText: question.questionText,
    marks: question.marks,
    options: (question.options || []).map((option: any) => ({ id: option.id, questionId: option.questionId, optionOrder: option.optionOrder, optionText: option.optionText })),
  };
}
