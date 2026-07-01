/**
 * Sentence boundary chunker for streaming LLM → TTS pipeline.
 *
 * Accumulates incoming text tokens and emits a chunk whenever a sentence
 * boundary is detected. The first chunk fires as soon as the first sentence
 * completes, so TTS can start while the LLM is still generating the rest of
 * the response. Subsequent chunks are emitted as each sentence finishes.
 *
 * Sentence boundary rules (priority order):
 *   1. '. ' / '! ' / '? ' — standard terminators followed by a space
 *   2. '.\n' / '!\n' / '?\n' — terminator followed by newline
 *   3. Buffer flush at 280 chars — prevents runaway accumulation on
 *      comma-heavy or list-style responses that never hit a period.
 *      280 chars ≈ ~20s of speech at natural pace; short enough that
 *      users hear something within ~1.5s of the first token.
 *
 * Usage:
 *   const chunker = new SentenceChunker((chunk) => synthesise(chunk));
 *   for await (const token of llmStream) chunker.push(token);
 *   chunker.flush(); // emit any trailing partial sentence
 */

const BOUNDARY_RE = /[.!?](?:\s|\n)/;
const FLUSH_AT    = 280; // chars

export class SentenceChunker {
  private buf = '';

  constructor(private readonly onChunk: (chunk: string) => void) {}

  push(token: string): void {
    this.buf += token;
    this.tryEmit();
  }

  /** Emit any remaining buffered text. Call once after the stream ends. */
  flush(): void {
    const trimmed = this.buf.trim();
    if (trimmed) {
      this.onChunk(trimmed);
      this.buf = '';
    }
  }

  private tryEmit(): void {
    for (;;) {
      const match = BOUNDARY_RE.exec(this.buf);
      if (!match) {
        // No sentence boundary yet — force-flush on size cap
        if (this.buf.length >= FLUSH_AT) {
          this.onChunk(this.buf.trim());
          this.buf = '';
        }
        break;
      }

      // Include the terminator in the emitted chunk, drop the trailing space/newline
      const end   = match.index + 1; // index of space/newline after terminator
      const chunk = this.buf.slice(0, end).trim();
      this.buf    = this.buf.slice(end + 1).trimStart(); // consume boundary char too

      if (chunk) this.onChunk(chunk);
    }
  }
}
