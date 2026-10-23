import { useEffect, useRef } from "react";

const MAX_HEIGHT = 220;

const ATTACH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const DOC_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 8 8" />
  </svg>
);

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  loading,
  textareaRef,
  file,
  onFileSelect,
  onFileClear,
  maxLength = 15000,
}) {
  const fileInputRef = useRef(null);

  // Grow the textarea with its content, like ChatGPT, up to a limit.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, textareaRef]);

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const handleAttachClick = () => {
    if (loading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    const picked = event.target.files?.[0];
    if (picked) onFileSelect?.(picked);
    // Allow picking the same file again later.
    event.target.value = "";
  };

  const overLimit = value.length > maxLength;
  const canSend =
    !overLimit &&
    (file?.kind === "image" ? Boolean(value.trim()) : Boolean(value.trim()) || Boolean(file));

  let placeholder = "Ask NexusAI anything... (research, code, math, logic)";
  if (file?.kind === "image") {
    placeholder = "Describe the edit you want, e.g. 'make the background a beach at sunset'";
  } else if (file) {
    placeholder = "Ask about this document... (Enter to send, Shift + Enter for new line)";
  }

  return (
    <div className="input-wrapper">
      <div className={`input-area-card${file ? " has-attachment" : ""}`}>
        {file ? (
          <div className="attachment-row">
            <button
              className="attach-button"
              onClick={handleAttachClick}
              disabled={loading}
              title="Attach a document or image"
              aria-label="Attach a document or image"
              type="button"
            >
              {ATTACH_ICON}
            </button>
            <span className="attachment-chip" title={file.filename}>
              {file.kind === "image" && file.preview ? (
                <img className="attachment-thumb" src={file.preview} alt="" />
              ) : (
                DOC_ICON
              )}
              <span className="attachment-chip-name">{file.filename}</span>
              <button
                className="attachment-remove"
                onClick={onFileClear}
                aria-label={`Remove ${file.filename}`}
                title="Remove attachment"
                type="button"
              >
                ✕
              </button>
            </span>
          </div>
        ) : (
          <button
            className="attach-button"
            onClick={handleAttachClick}
            disabled={loading}
            title="Attach a document or image"
            aria-label="Attach a document or image"
            type="button"
          >
            {ATTACH_ICON}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
          onChange={handleFileChange}
          hidden
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-label="Message NexusAI"
        />

        {loading ? (
          <button
            className="send-button stop-button"
            onClick={onStop}
            title="Stop generating"
            aria-label="Stop generating"
            type="button"
          >
            <span className="stop-icon" />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={onSend}
            disabled={!canSend}
            title="Send message (Enter)"
            aria-label="Send message"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>

      <div className="input-hint-row">
        <span className="hint-pill">Press Enter ↵ to send</span>
        <span className="hint-divider">·</span>
        <span className="hint-pill">Shift + Enter for new line</span>
        {value.length >= maxLength * 0.8 ? (
          <span
            className={`char-counter${overLimit ? " is-over" : ""}`}
            aria-live="polite"
            title={`Message limit: ${maxLength.toLocaleString()} characters`}
          >
            {value.length.toLocaleString()} / {maxLength.toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
