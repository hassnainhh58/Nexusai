import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatModelName } from "../lib/format.js";
import CodeBlock from "./CodeBlock.jsx";

const SUGGESTIONS = [
  {
    icon: "⚡",
    title: "Capabilities",
    prompt: "What can you help me with?",
    description: "What can you help me with across engineering & research?",
  },
  {
    icon: "🔍",
    title: "Live Search",
    prompt: "What is the latest version of Python?",
    description: "What is the latest version of Python and its key features?",
  },
  {
    icon: "🧮",
    title: "Calculator",
    prompt: "What is 125 * 48?",
    description: "Calculate 125 * 48 with step-by-step arithmetic.",
  },
  {
    icon: "💡",
    title: "Concepts",
    prompt: "Explain Python variables simply.",
    description: "Explain Python variables and memory management simply.",
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
  canRegenerate,
  isStreaming,
}) {
  const messageId = item.id ? `msg-${item.id}` : `msg-${index}`;

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
            <CopyButton
              copied={copiedId === messageId}
              label="Copy"
              onClick={() => onCopy(item.content, messageId)}
            />
          </div>
          <div className="user-message-text">{item.content}</div>
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

        {canRegenerate && item.content && !item.error && (
          <div className="assistant-message-actions">
            <button
              type="button"
              className="message-action-btn"
              onClick={onRegenerate}
              disabled={isStreaming}
              title="Generate a new answer for this question"
            >
              ↻ Regenerate
            </button>
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
        Your professional AI assistant for research, logic, calculations, code
        development, and complex problem-solving.
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
  loading,
  canRegenerate,
  endRef,
}) {
  if (messages.length === 0) {
    return (
      <div className="messages-container">
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
            canRegenerate={Boolean(canRegenerate) && index === lastIndex}
            isStreaming={loading}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
