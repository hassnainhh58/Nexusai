import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient, uploadFile } from "./api.js";

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
