import { StringDecoder } from 'node:string_decoder';

const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_CHUNKS = 256;

export class ByteLogBuffer {
  private readonly chunks: string[] = [];
  private decoder = new StringDecoder('utf8');
  private storedBytes = 0;
  private totalDecodedBytes = 0;

  constructor(public readonly maxBytes: number = DEFAULT_MAX_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive safe integer.');
    }
  }

  get byteLength(): number {
    return this.storedBytes;
  }

  append(value: string | Buffer): void {
    const decoded = this.decoder.write(typeof value === 'string' ? Buffer.from(value) : value);
    if (!decoded) return;
    const decodedBytes = Buffer.byteLength(decoded);
    if (this.chunks.length >= MAX_CHUNKS) {
      const compacted = this.chunks.join('');
      this.chunks.length = 0;
      if (compacted) this.chunks.push(compacted);
    }
    this.chunks.push(decoded);
    this.storedBytes += decodedBytes;
    this.totalDecodedBytes += decodedBytes;
    this.trimToLimit();
  }

  toString(): string {
    return this.chunks.join('');
  }

  lines(): string[] {
    const text = this.toString();
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    return lines;
  }

  readSince(offset: number): { text: string; nextOffset: number; truncated: boolean } {
    const requestedOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const startOffset = this.totalDecodedBytes - this.storedBytes;
    const reset = requestedOffset > this.totalDecodedBytes;
    const truncated = reset || requestedOffset < startOffset;
    const effectiveOffset = reset ? startOffset : Math.max(requestedOffset, startOffset);
    const relativeOffset = Math.min(effectiveOffset - startOffset, this.storedBytes);
    return {
      text: sliceAfterUtf8Bytes(this.toString(), relativeOffset),
      nextOffset: this.totalDecodedBytes,
      truncated,
    };
  }

  clear(): void {
    this.chunks.length = 0;
    this.storedBytes = 0;
    this.totalDecodedBytes = 0;
    this.decoder = new StringDecoder('utf8');
  }

  private trimToLimit(): void {
    let excess = this.storedBytes - this.maxBytes;
    while (excess > 0 && this.chunks.length > 0) {
      const first = this.chunks[0];
      const firstBytes = Buffer.byteLength(first);
      if (firstBytes <= excess) {
        this.chunks.shift();
        this.storedBytes -= firstBytes;
        excess -= firstBytes;
        continue;
      }

      let removedCodeUnits = 0;
      let removedBytes = 0;
      for (const codePoint of first) {
        removedCodeUnits += codePoint.length;
        removedBytes += Buffer.byteLength(codePoint);
        if (removedBytes >= excess) break;
      }
      this.chunks[0] = first.slice(removedCodeUnits);
      this.storedBytes -= removedBytes;
      excess = this.storedBytes - this.maxBytes;
    }
  }
}

export class ByteLogCursor {
  private offset = 0;

  read(buffer: ByteLogBuffer): { lines: string[]; truncated: boolean } {
    const snapshot = buffer.readSince(this.offset);
    this.offset = snapshot.nextOffset;
    return {
      lines: snapshot.text ? snapshot.text.split(/\r?\n/).filter(Boolean) : [],
      truncated: snapshot.truncated,
    };
  }

  reset(): void {
    this.offset = 0;
  }
}

function sliceAfterUtf8Bytes(value: string, byteOffset: number): string {
  if (byteOffset <= 0) return value;
  let consumedBytes = 0;
  let consumedCodeUnits = 0;
  for (const codePoint of value) {
    if (consumedBytes >= byteOffset) break;
    consumedBytes += Buffer.byteLength(codePoint);
    consumedCodeUnits += codePoint.length;
  }
  return value.slice(consumedCodeUnits);
}
