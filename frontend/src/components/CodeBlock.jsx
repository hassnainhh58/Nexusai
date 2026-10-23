import { Suspense, lazy, useState } from "react";

const HighlightedCode = lazy(() => import("./HighlightedCode.jsx"));

export default function CodeBlock({ language, code, theme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  };

  const displayLanguage =
    language && language !== "code" && language !== "text" ? language : "code";

  return (
    <div className="code-block-card">
      <div className="code-block-header">
        <span className="code-language-tag">{displayLanguage.toUpperCase()}</span>
        <button
          className={`code-copy-button ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          type="button"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <span className="copy-icon-check">✓</span>
              <span>Copied!</span>
            </>
          ) : (
            <>
              <svg
                className="copy-svg-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <div className="code-block-body">
        <Suspense
          fallback={
            <pre className="code-fallback">
              <code>{code}</code>
            </pre>
          }
        >
          <HighlightedCode language={language} code={code} theme={theme} />
        </Suspense>
      </div>
    </div>
  );
}
