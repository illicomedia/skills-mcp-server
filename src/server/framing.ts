const NEWLINE = 0x0a;

/**
 * Splits a byte stream into lines while never holding more than `maxBytes` of one line:
 * a line that grows past the cap is dropped as it arrives (not after it is fully read),
 * reported once through `onOversize`, and the framer resumes at the next newline.
 * Lines are decoded as UTF-8 only once complete, so a multi-byte character may span chunks.
 */
export class LineFramer {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private discarding = false;

  constructor(
    private readonly maxBytes: number,
    private readonly onLine: (line: string) => void,
    private readonly onOversize: () => void,
  ) {}

  push(chunk: Buffer): void {
    let start = 0;
    while (start <= chunk.length) {
      const newline = chunk.indexOf(NEWLINE, start);
      const end = newline === -1 ? chunk.length : newline;
      this.take(chunk.subarray(start, end));
      if (newline === -1) {
        return;
      }
      this.finishLine();
      start = newline + 1;
    }
  }

  /** The stream ended: a last line without a trailing newline still counts. */
  end(): void {
    this.finishLine();
  }

  private take(part: Buffer): void {
    if (this.discarding || part.length === 0) {
      return;
    }
    if (this.pendingBytes + part.length > this.maxBytes) {
      this.pending = [];
      this.pendingBytes = 0;
      this.discarding = true;
      this.onOversize();
      return;
    }
    // A copy: a view would keep the whole incoming chunk alive and see later changes to it.
    this.pending.push(Buffer.from(part));
    this.pendingBytes += part.length;
  }

  private finishLine(): void {
    const wasDiscarding = this.discarding;
    const line = Buffer.concat(this.pending).toString('utf8');
    this.pending = [];
    this.pendingBytes = 0;
    this.discarding = false;
    if (!wasDiscarding) {
      this.onLine(line);
    }
  }
}
