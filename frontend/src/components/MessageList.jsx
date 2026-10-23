import { memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatModelName, formatRelativeTime } from "../lib/format.js";
import CodeBlock from "./CodeBlock.jsx";

// Very long user messages (large pastes or attachments) are collapsed in the
// transcript so the conversation stays responsive; the model still receives the
// full text.
const USER_PREVIEW_CHARS = 2000;

const SUGGESTIONS = [
  {
    icon: "🔍",
    title: "Research",
    prompt: "What are the most important recent developments in artificial intelligence?",
    description: "Find and summarize the latest developments in AI.",
  },
  {
    icon: "💻",
    title: "Code",
    prompt: "Write a Python script that renames every file in a folder by date.",
    description: "Build, debug or explain code in any language.",
  },
  {
    icon: "✍️",
    title: "Writing",
    prompt: "Draft a concise, professional email asking a client to reschedule a meeting.",
    description: "Draft, edit, summarize or translate any text.",
  },
  {
    icon: "📊",
    title: "Analysis",
    prompt: "Compare SQL and NoSQL databases for a real-time analytics product.",
    description: "Break down trade-offs, data and decisions.",
  },
  {
    icon: "🧮",
    title: "Math",
    prompt: "Calculate the compound interest on $12,500 at 6.5% for 8 years.",
    description: "Exact calculations, step by step.",
  },
  {
    icon: "🧭",
    title: "Planning",
    prompt: "Plan a focused 30-day learning path for becoming a backend developer.",
    description: "Turn a goal into a practical plan.",
  },
];

function CopyButton({ copied, label, onClick }) {
  return (
    <button className="copy-action-btn" onClick={onClick} title={label} type="button">
      {copied ? (
        <>
          <span className="copy-feedback-icon">✓</span>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

const MessageTurn = memo(function MessageTurn({
  item,
  index,
  theme,
  copiedId,
  onCopy,
  onRegenerate,
  onEdit,
  onFeedback,
  canRegenerate,
  isStreaming,
}) {
  const messageId = item.id ? `msg-${item.id}` : `msg-${index}`;
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const isLongUserMessage =
    item.role === "user" && item.content.length > USER_PREVIEW_CHARS;
  const timestamp = formatRelativeTime(item.created_at);
  const canEdit = Boolean(item.id) && !item.image && !isStreaming;

  const submitEdit = () => {
    const next = draft.trim();
    if (!next || isStreaming) return;
    setEditing(false);
    onEdit?.(item.id, next);
  };

  const cancelEdit = () => {
    setDraft(item.content);
    setEditing(false);
  };

  const markdownComponents = useMemo(
    () => ({
      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        const rawCode = String(children).replace(/\n$/, "");
        const isMultiline = rawCode.includes("\n");

        if (match || isMultiline) {
          return (
            <CodeBlock
              language={match ? match[1] : "code"}
              code={rawCode}
              theme={theme}
            />
          );
        }
        return (
          <code className="inline-code" {...props}>
            {children}
          </code>
        );
      },
      a({ href, children, ...props }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="markdown-link"
            {...props}
          >
            {children}
          </a>
        );
      },
      img({ src, alt }) {
        return (
          <img
            className="message-image generated-image"
            src={src}
            alt={alt || "Edited image"}
            loading="lazy"
          />
        );
      },
      table({ children }) {
        return (
          <div className="table-responsive-wrapper">
            <table className="markdown-table">{children}</table>
          </div>
        );
      },
    }),
    [theme]
  );

  if (item.role === "user") {
    return (
      <div className="message-turn user-turn">
        <div className="user-message-container">
          <div className="user-message-header">
            <span className="user-badge">You</span>
            <div className="message-header-actions">
              {timestamp ? (
                <time className="message-timestamp" title={item.created_at}>
                  {timestamp}
                </time>
              ) : null}
              <CopyButton
                copied={copiedId === messageId}
                label="Copy"
                onClick={() => onCopy(item.content, messageId)}
              />
              {canEdit ? (
                <button
                  className="message-action-btn message-inline-action"
                  onClick={() => {
                    setDraft(item.content);
                    setEditing(true);
                  }}
                  title="Edit this message and answer it again"
                  type="button"
                >
                  ✏ Edit
                </button>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="message-edit-form">
              <textarea
                className="message-edit-textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancelEdit();
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    submitEdit();
                  }
                }}
                rows={Math.min(12, Math.max(3, Math.ceil(draft.length / 90)))}
                autoFocus
                aria-label="Edit message"
              />
              <div className="message-edit-actions">
                <button
                  className="message-action-btn"
                  onClick={submitEdit}
                  disabled={!draft.trim() || isStreaming}
                  type="button"
                >
                  Save &amp; submit
                </button>
                <button
                  className="message-action-btn"
                  onClick={cancelEdit}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="user-message-text">
                {item.image ? (
                  <img
                    className="message-image message-source-image"
                    src={item.image}
                    alt="Attached image"
                  />
                ) : null}
                {isLongUserMessage && !expanded
                  ? `${item.content.slice(0, USER_PREVIEW_CHARS)}…`
                  : item.content}
              </div>
              {isLongUserMessage ? (
                <button
                  type="button"
                  className="message-action-btn message-expand-btn"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded
                    ? "Show less"
                    : `Show full message (${item.content.length.toLocaleString()} characters)`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="message-turn assistant-turn">
      <div className="assistant-message-container">
        <div className="assistant-message-header">
          <div className="assistant-avatar">
            <span>◈</span>
          </div>
          <div className="assistant-meta">
            <span className="assistant-name">NexusAI</span>
            <span className="assistant-role-pill">
              {formatModelName(item.model)}
            </span>
          </div>
          {item.stopped && <span className="message-state-badge">Stopped</span>}
          {timestamp ? (
            <time className="message-timestamp" title={item.created_at}>
              {timestamp}
            </time>
          ) : null}
          {item.content && (
            <CopyButton
              copied={copiedId === messageId}
              label="Copy answer"
              onClick={() => onCopy(item.content, messageId)}
            />
          )}
        </div>

        <div className="assistant-message-content">
          {item.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {item.content}
            </ReactMarkdown>
          ) : item.error ? null : (
            <div className="typing-indicator-box">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-text">
                {isStreaming ? "NexusAI is generating response..." : "Waiting for response..."}
              </span>
            </div>
          )}

          {item.error && (
            <div className="message-error-card" role="alert">
              <span className="message-error-icon">!</span>
              <div className="message-error-body">
                <strong>The response could not be completed</strong>
                <span>{item.error}</span>
              </div>
              {canRegenerate && (
                <button
                  type="button"
                  className="message-action-btn"
                  onClick={onRegenerate}
                  disabled={isStreaming}
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {!item.error && item.content && (canRegenerate || item.id) && (
          <div className="assistant-message-actions">
            {canRegenerate ? (
              <button
                type="button"
                className="message-action-btn"
                onClick={onRegenerate}
                disabled={isStreaming}
                title="Generate a new answer for this question"
              >
                ↻ Regenerate
              </button>
            ) : null}

            {item.id && !isStreaming ? (
              <div className="message-feedback" role="group" aria-label="Rate this answer">
                <button
                  type="button"
                  className={`feedback-button${item.feedback === "up" ? " active" : ""}`}
                  onClick={() =>
                    onFeedback?.(
                      item.id,
                      item.feedback === "up" ? null : "up",
                      item.feedback ?? null
                    )
                  }
                  aria-pressed={item.feedback === "up"}
                  title="Helpful"
                  aria-label="Mark this answer as helpful"
                >
                  👍
                </button>
                <button
                  type="button"
                  className={`feedback-button${item.feedback === "down" ? " active" : ""}`}
                  onClick={() =>
                    onFeedback?.(
                      item.id,
                      item.feedback === "down" ? null : "down",
                      item.feedback ?? null
                    )
                  }
                  aria-pressed={item.feedback === "down"}
                  title="Not helpful"
                  aria-label="Mark this answer as not helpful"
                >
                  👎
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
});

function WelcomeScreen({ onSuggestion }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-hero-badge">
        <span className="welcome-hero-icon">◈</span>
      </div>

      <h1 className="welcome-heading">Welcome to NexusAI</h1>
      <p className="welcome-subheading">
        Ask anything — research, writing, code, math, analysis, planning and
        everyday questions. Attach a document to work with it, or dictate your
        message with the microphone.
      </p>

      <div className="suggestion-grid">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            className="suggestion-card"
            onClick={() => onSuggestion(suggestion.prompt)}
          >
            <div className="suggestion-card-header">
              <span className="suggestion-icon">{suggestion.icon}</span>
              <strong>{suggestion.title}</strong>
            </div>
            <span className="suggestion-prompt">{suggestion.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MessageList({
  messages,
  theme,
  copiedId,
  onCopy,
  onSuggestion,
  onRegenerate,
  onEdit,
  onFeedback,
  loading,
  canRegenerate,
  endRef,
  containerRef,
  onScroll,
}) {
  if (messages.length === 0) {
    return (
      <div className="messages-container" ref={containerRef} onScroll={onScroll}>
        <WelcomeScreen onSuggestion={onSuggestion} />
      </div>
    );
  }

  const lastIndex = messages.length - 1;

  return (
    <div
      className="messages-container"
      role="log"
      aria-live="polite"
      aria-busy={loading}
      aria-label="Conversation"
      ref={containerRef}
      onScroll={onScroll}
    >
      <div className="messages-feed">
        {messages.map((item, index) => (
          <MessageTurn
            key={item.id ?? `${item.role}-${index}`}
            item={item}
            index={index}
            theme={theme}
            copiedId={copiedId}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onEdit={onEdit}
            onFeedback={onFeedback}
            canRegenerate={Boolean(canRegenerate) && index === lastIndex}
            isStreaming={loading}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
