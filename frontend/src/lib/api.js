// Same-origin by default: Vite's dev server proxies /api to the FastAPI
// backend, so no CORS preflight is involved.
// Set VITE_API_URL (e.g. "http://127.0.0.1:8000") to call the backend directly.
export const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Builds a fetch wrapper that attaches the Clerk session token.
 *
 * A 401 is retried exactly once with `skipCache: true`: Clerk caches session
 * tokens for ~60 seconds, so a token that was just rotated would otherwise be
 * sent again and fail again.
 */
export function createApiClient(getToken) {
  return async function apiFetch(path, options = {}) {
    const request = async (skipCache) => {
      const headers = new Headers(options.headers || {});
      if (options.body instanceof FormData) {
        // Let the browser set the multipart boundary when serialising FormData.
        headers.delete("Content-Type");
      }
      try {
        const token = await getToken({ skipCache });
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }
      } catch {
        // Not signed in (or token unavailable): let the API answer 401.
      }
      return fetch(`${API_URL}${path}`, { ...options, headers });
    };

    const response = await request(false);
    if (response.status === 401) {
      return request(true);
    }
    return response;
  };
}

/**
 * Uploads a document to the backend, which validates its type and returns the
 * extracted text. The caller composes that text into the next chat message.
 */
export async function uploadFile(apiFetch, file) {
  const body = new FormData();
  body.append("file", file);
  const response = await apiFetch("/api/files/upload", {
    method: "POST",
    body,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
}

/** Extracts a readable error message from a failed response. */
export async function readErrorMessage(response) {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
      return body.detail[0].msg;
    }
  } catch {
    // Response was not JSON (proxy error, empty body, ...).
  }
  if (response.status === 401) return "Your session expired. Please sign in again.";
  if (response.status === 429) return "You are sending messages too quickly. Please wait a moment.";
  return `Request failed (HTTP ${response.status}).`;
}
