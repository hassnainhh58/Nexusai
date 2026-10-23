import { describe, expect, it } from "vitest";

import { createSseParser } from "./sse.js";

describe("createSseParser", () => {
  it("parses a complete event block", () => {
    const parser = createSseParser();
    const events = parser.push('event: token\ndata: {"text":"Hello"}\n\n');
    expect(events).toEqual([{ event: "token", data: { text: "Hello" } }]);
  });

  it("reassembles an event split across chunks", () => {
    const parser = createSseParser();
    expect(parser.push('event: tok')).toEqual([]);
    expect(parser.push('en\ndata: {"text":"Hel')).toEqual([]);
    expect(parser.push('lo"}\n\n')).toEqual([
      { event: "token", data: { text: "Hello" } },
    ]);
  });

  it("handles several events in one chunk", () => {
    const parser = createSseParser();
    const events = parser.push(
      'event: meta\ndata: {"model":"m"}\n\nevent: token\ndata: {"text":"a"}\n\n'
    );
    expect(events.map((event) => event.event)).toEqual(["meta", "token"]);
  });

  it("normalises CRLF line endings", () => {
    const parser = createSseParser();
    const events = parser.push('event: token\r\ndata: {"text":"x"}\r\n\r\n');
    expect(events[0].data.text).toBe("x");
  });

  it("keeps newlines inside JSON payloads", () => {
    const parser = createSseParser();
    const events = parser.push('event: token\ndata: {"text":"a\\n\\nb"}\n\n');
    expect(events[0].data.text).toBe("a\n\nb");
  });

  it("ignores comments and unknown fields", () => {
    const parser = createSseParser();
    const events = parser.push(': keep-alive\nevent: token\ndata: {"text":"y"}\n\n');
    expect(events).toEqual([{ event: "token", data: { text: "y" } }]);
  });

  it("falls back to raw text for non-JSON payloads", () => {
    const parser = createSseParser();
    const events = parser.push("event: token\ndata: plain text\n\n");
    expect(events[0].data.text).toBe("plain text");
  });

  it("flushes a trailing event without a blank line", () => {
    const parser = createSseParser();
    parser.push('event: done\ndata: {"conversation_id":1}');
    expect(parser.flush()).toEqual([
      { event: "done", data: { conversation_id: 1 } },
    ]);
    expect(parser.flush()).toEqual([]);
  });
});
