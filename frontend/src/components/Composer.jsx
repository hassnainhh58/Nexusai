import { useEffect, useRef, useState } from "react";

const MAX_HEIGHT = 220;

const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const MIC_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
);
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
  onAppendText,
}) {
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  // Grow the textarea with its content, like ChatGPT, up to a limit.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value, textareaRef]);

  // Stop an in-flight dictation when the composer unmounts.
  useEffect(
    () => () => {
      recognitionRef.current?.stop?.();
    },
    []
  );

  const toggleListening = () => {
    if (!SpeechRecognitionCtor || loading) return;
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        if (event.results[index].isFinal) {
          transcript += event.results[index][0].transcript;
        }
      }
      const text = transcript.trim();
      if (!text) return;
      if (onAppendText) onAppendText(text);
      else onChange(`${value}${value ? " " : ""}${text}`);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

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

  const canSend =
    file?.kind === "image" ? Boolean(value.trim()) : Boolean(value.trim()) || Boolean(file);

  let placeholder = "Ask anything — research, writing, code, math, planning…";
  if (file?.kind === "image") {
    placeholder = "Describe the edit you want, e.g. 'make the background a beach at sunset'";
  } else if (file) {
    placeholder = "Ask about this document… (Enter to send, Shift + Enter for new line)";
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

        {SpeechRecognitionCtor ? (
          <button
            className={`mic-button${listening ? " is-listening" : ""}`}
            onClick={toggleListening}
            disabled={loading}
            title={listening ? "Stop dictation" : "Dictate a message"}
            aria-label={listening ? "Stop dictation" : "Dictate a message"}
            aria-pressed={listening}
            type="button"
          >
            {MIC_ICON}
          </button>
        ) : null}

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
      </div>
    </div>
  );
}
