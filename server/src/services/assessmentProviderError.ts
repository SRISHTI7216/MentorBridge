/** Safe provider failure metadata shared by assessment generation providers. */
export class AssessmentProviderError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AssessmentProviderError';
  }
}
