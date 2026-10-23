/** Presentation helpers shared by the sidebar, the composer and the tests. */

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`]*)`/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_NOISE = /^[#>~*\-+\s]+/gm;
const WHITESPACE = /\s+/g;

/**
 * Derives a short, readable conversation title from the first message.
 *
 * Mirrors the backend heuristic (`derive_title` in chat_service.py) so the
 * optimistic sidebar entry matches the title the server stores.
 */
export function deriveTitle(text, { maxWords = 6, maxLength = 60 } = {}) {
  const cleaned = String(text ?? "")
    .replace(CODE_FENCE, " ")
    .replace(INLINE_CODE, "$1")
    .replace(LINK, "$1")
    .replace(MARKDOWN_NOISE, " ")
    .replace(WHITESPACE, " ")
    .trim();

  if (!cleaned) return "New Chat";

  const words = cleaned.split(" ");
  let title = words.slice(0, maxWords).join(" ");
  if (words.length > maxWords || title.length > maxLength) {
    title = `${title.slice(0, maxLength).replace(/[ ,.;:-]+$/, "")}…`;
  }
  return title || "New Chat";
}

/** Human friendly label for a model identifier. */
export function formatModelName(model) {
  if (!model) return "Nexus Core";
  const raw = model.includes("/") ? model.split("/").pop() : model;
  const isFree = /:free$/i.test(raw);
  const label = raw
    .replace(/:free$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return isFree ? `${label} (free)` : label;
}

/** Formats a server timestamp as a compact relative time. */
export function formatRelativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
