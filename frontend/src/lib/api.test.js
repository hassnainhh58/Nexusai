import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient, editImage, readErrorMessage, uploadFile } from "./api.js";

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("uploadFile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({ filename: "notes.txt", size_bytes: 6, extracted_text: "hello" })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the file as multipart and returns the extracted text", async () => {
    const apiFetch = createApiClient(async () => "test-token");
    const info = await uploadFile(apiFetch, { name: "notes.txt" });

    expect(info.extracted_text).toBe("hello");
    expect(info.filename).toBe("notes.txt");

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/files/upload");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
  });

  it("throws the server error message when the upload fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: "The uploaded .pdf file does not look like a valid PDF document.",
      }),
    });

    const apiFetch = createApiClient(async () => "test-token");
    await expect(uploadFile(apiFetch, { name: "broken.pdf" })).rejects.toThrow(
      "The uploaded .pdf file does not look like a valid PDF document."
    );
  });
});

describe("editImage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          conversation_id: 12,
          image: "data:image/png;base64,AAAA",
          media_type: "image/png",
          model: "test-image-model",
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the image, the prompt and the conversation id", async () => {
    const apiFetch = createApiClient(async () => "test-token");
    const file = new Blob(["fake-png"], { type: "image/png" });

    const result = await editImage(apiFetch, file, "make it blue", 12);

    expect(result.image).toContain("data:image/png");
    expect(result.conversation_id).toBe(12);

    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/api/images/edit");
    expect(options.method).toBe("POST");

    const entries = [...options.body.entries()];
    expect(entries.map(([key]) => key)).toEqual(["image", "prompt", "conversation_id"]);
    expect(entries[1][1]).toBe("make it blue");
    expect(entries[2][1]).toBe("12");
  });
});

describe("readErrorMessage", () => {
  it("reports the field that failed validation", async () => {
    const response = {
      status: 422,
      json: async () => ({
        detail: [
          {
            field: "message",
            message: "String should have at most 15000 characters",
            type: "string_too_long",
          },
        ],
      }),
    };

    await expect(readErrorMessage(response)).resolves.toBe(
      "message: String should have at most 15000 characters"
    );
  });

  it("falls back to a readable message when the body is not JSON", async () => {
    const response = {
      status: 429,
      json: async () => {
        throw new Error("not json");
      },
    };

    await expect(readErrorMessage(response)).resolves.toContain("too quickly");
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse({})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not force a multipart content type so fetch can set the boundary", async () => {
    const apiFetch = createApiClient(async () => "test-token");
    await apiFetch("/api/files/upload", { method: "POST", body: new FormData() });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options.headers.get("Content-Type")).toBeNull();
  });
});
