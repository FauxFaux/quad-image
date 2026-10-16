export interface ServerEvent {
  event: string;
  data: string;
}

/** Parse SSE text incrementally, including lines split across chunks. */
export class ServerEventParser {
  private buffer = '';
  private event = 'message';
  private data: string[] = [];

  push(chunk: string, done = false): ServerEvent[] {
    this.buffer += chunk;
    const events: ServerEvent[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r\n|\r|\n/.exec(this.buffer))) {
      // A trailing CR may be the first half of CRLF in the next chunk.
      if (
        !done &&
        match[0] === '\r' &&
        match.index === this.buffer.length - 1
      ) {
        break;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      if (line === '') {
        if (this.data.length) {
          events.push({ event: this.event, data: this.data.join('\n') });
        }
        this.event = 'message';
        this.data = [];
      } else {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') this.event = value || 'message';
        if (field === 'data') this.data.push(value);
      }
    }
    // SSE requires a blank line to dispatch; incomplete trailing events are lost.
    return events;
  }
}
