/**
 * Minimal, dependency-free Server-Sent Events parser.
 *
 * The backend streams newline-delimited JSON events:
 *
 *   event: token
 *   data: {"text":"Hello"}
 *
 * Framing is handled here instead of in the component so it can be unit
 * tested: chunks may split an event in the middle, and `\r\n` is normalised.
 */

function parseBlock(block) {
  let event = "message";
  const dataLines = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }

  if (dataLines.length === 0) return null;

  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    // Be tolerant of a plain-text payload from an older proxy/backend.
    return { event, data: { text: raw } };
  }
}

export function createSseParser() {
  let buffer = "";

  return {
    push(chunk) {
      buffer += String(chunk).replace(/\r\n/g, "\n");
      const events = [];

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseBlock(block);
        if (parsed) events.push(parsed);
        boundary = buffer.indexOf("\n\n");
      }

      return events;
    },

    flush() {
      if (!buffer.trim()) {
        buffer = "";
        return [];
      }
      const parsed = parseBlock(buffer);
      buffer = "";
      return parsed ? [parsed] : [];
    },
  };
}

/**
 * Reads an SSE response body until it ends, invoking `onEvent` per event.
 *
 * The reader is always released, including when `onEvent` throws or the
 * request is aborted.
 */
export async function consumeSseResponse(response, { onEvent, signal } = {}) {
  if (!response.body) {
    throw new Error("The server returned an empty response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = createSseParser();
  const emit = (events) => {
    for (const event of events) {
      if (signal?.aborted) return;
      onEvent(event);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      emit(parser.push(decoder.decode(value, { stream: true })));
    }

    emit(parser.push(decoder.decode()));
    emit(parser.flush());
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released.
    }
  }
}
