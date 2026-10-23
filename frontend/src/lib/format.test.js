import { describe, expect, it } from "vitest";

import { deriveTitle, formatModelName, formatRelativeTime } from "./format.js";

describe("deriveTitle", () => {
  it("keeps short messages intact", () => {
    expect(deriveTitle("hello world")).toBe("hello world");
  });

  it("truncates long messages with an ellipsis", () => {
    const title = deriveTitle("one two three four five six seven eight");
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it("strips code fences", () => {
    expect(deriveTitle("```python\nprint('x')\n```")).toBe("New Chat");
    expect(deriveTitle("fix this: ```js\nconst a = 1;\n``` please")).toBe(
      "fix this: please"
    );
  });

  it("strips markdown headings and links", () => {
    expect(deriveTitle("# Hello [world](https://example.com)")).toBe("Hello world");
  });

  it("handles empty input", () => {
    expect(deriveTitle("")).toBe("New Chat");
    expect(deriveTitle(null)).toBe("New Chat");
    expect(deriveTitle("   ")).toBe("New Chat");
  });
});

describe("formatModelName", () => {
  it("humanises provider-prefixed identifiers", () => {
    expect(formatModelName("x-ai/grok-4.3")).toBe("Grok 4.3");
  });

  it("marks free models", () => {
    expect(formatModelName("nvidia/nemotron-3-ultra:free")).toBe(
      "Nemotron 3 Ultra (free)"
    );
  });

  it("falls back for missing models", () => {
    expect(formatModelName("")).toBe("Nexus Core");
  });
});

describe("formatRelativeTime", () => {
  it("formats recent timestamps", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("just now");
    expect(formatRelativeTime(new Date(Date.now() - 120000).toISOString())).toBe("2m ago");
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});
