export type AnswerSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function toggleObjectiveAnswer(
  questionType: string,
  optionId: string,
  selectedOptionIds: string[] = [],
) {
  if (questionType === 'multiple_select') {
    return {
      selectedOptionId: undefined,
      selectedOptionIds: selectedOptionIds.includes(optionId)
        ? selectedOptionIds.filter(id => id !== optionId)
        : [...selectedOptionIds, optionId],
    };
  }
  return { selectedOptionId: optionId, selectedOptionIds: [] as string[] };
}

type QueueEntry<T> = {
  value: T;
  version: number;
  savedVersion: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<boolean>;
};

/** Serializes per-question saves and repeats the latest version if edits arrive during a request. */
export class AnswerSaveQueue<T> {
  private entries = new Map<string, QueueEntry<T>>();

  constructor(
    private readonly save: (questionId: string, value: T) => Promise<void>,
    private readonly onStatus: (questionId: string, status: AnswerSaveStatus) => void,
  ) {}

  schedule(questionId: string, value: T, delayMs = 300) {
    const entry = this.getEntry(questionId, value);
    entry.value = value;
    entry.version += 1;
    if (entry.timer) clearTimeout(entry.timer);
    this.onStatus(questionId, 'saving');
    entry.timer = setTimeout(() => { void this.flush(questionId); }, delayMs);
  }

  flush(questionId: string): Promise<boolean> {
    const entry = this.entries.get(questionId);
    if (!entry) return Promise.resolve(true);
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.inFlight) return entry.inFlight;
    if (entry.savedVersion === entry.version) return Promise.resolve(true);

    entry.inFlight = (async () => {
      try {
        while (entry.savedVersion < entry.version) {
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
          const requestedVersion = entry.version;
          const requestedValue = entry.value;
          await this.save(questionId, requestedValue);
          entry.savedVersion = requestedVersion;
        }
        this.onStatus(questionId, 'saved');
        return true;
      } catch {
        this.onStatus(questionId, 'error');
        return false;
      } finally {
        entry.inFlight = undefined;
      }
    })();
    return entry.inFlight;
  }

  async flushAll(): Promise<boolean> {
    const questionIds = [...this.entries.keys()];
    const results = await Promise.all(questionIds.map(questionId => this.flush(questionId)));
    return results.every(Boolean);
  }

  reset() {
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
  }

  private getEntry(questionId: string, initialValue: T): QueueEntry<T> {
    let entry = this.entries.get(questionId);
    if (!entry) {
      entry = { value: initialValue, version: 0, savedVersion: 0 };
      this.entries.set(questionId, entry);
    }
    return entry;
  }
}
