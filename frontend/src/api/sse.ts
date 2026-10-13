import { Buffer } from 'buffer';

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser over raw bytes. Lines are split on byte 0x0A before
 * decoding, so a UTF-8 character split across network chunks (Hindi or Malayalam text) is
 * never decoded in halves; no TextDecoder is needed (Hermes may not have one).
 */
export class SseParser {
  private pending = new Uint8Array(0);
  private event = 'message';
  private data: string[] = [];

  /** Feeds a chunk; returns the events it completed. */
  push(chunk: Uint8Array): SseEvent[] {
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending);
    buf.set(chunk, this.pending.length);
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0a) continue;
      let line = Buffer.from(buf.subarray(start, i)).toString('utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      start = i + 1;
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    this.pending = buf.slice(start);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = 'message';
        return null;
      }
      const ev = { event: this.event, data: this.data.join('\n') };
      this.event = 'message';
      this.data = [];
      return ev;
    }
    if (line.startsWith(':')) return null; // comment / heartbeat
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}
