import { useEffect } from "react";

const MAX_HEIGHT = 220;

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  loading,
  textareaRef,
}) {
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

  return (
    <div className="input-wrapper">
      <div className="input-area-card">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask NexusAI anything... (research, code, math, logic)"
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
            disabled={!value.trim()}
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
      </div>
    </div>
  );
}
