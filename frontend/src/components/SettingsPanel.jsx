import { useEffect, useRef } from "react";

import { formatModelName } from "../lib/format.js";

export default function SettingsPanel({
  open,
  onClose,
  theme,
  onToggleTheme,
  model,
  version,
}) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <h2 id="settings-title">Settings &amp; Preferences</h2>
            <p>Configure NexusAI workspace appearance and tools</p>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-close"
            onClick={onClose}
            aria-label="Close settings"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <div className="settings-row">
              <div>
                <strong>Theme</strong>
                <span>Select interface appearance mode</span>
              </div>
              <button
                className="theme-toggle-btn"
                onClick={onToggleTheme}
                type="button"
              >
                <span className="theme-toggle-icon">
                  {theme === "dark" ? "🌙" : "☀️"}
                </span>
                <span className="theme-toggle-text">
                  {theme === "dark" ? "Dark Mode" : "Light Mode"}
                </span>
              </button>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">AI Engine</div>
            <div className="settings-row">
              <div>
                <strong>Active Model</strong>
                <span>Current intelligence backbone</span>
              </div>
              <div className="settings-badge-value">{formatModelName(model)}</div>
            </div>

            <div className="settings-row">
              <div>
                <strong>Live Web Search</strong>
                <span>Real-time web research integration</span>
              </div>
              <div className="settings-status-enabled">Active</div>
            </div>

            <div className="settings-row">
              <div>
                <strong>Mathematical Calculator</strong>
                <span>Precise evaluation tool</span>
              </div>
              <div className="settings-status-enabled">Active</div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">System Health</div>
            <div className="settings-row">
              <div>
                <strong>Backend Server</strong>
                <span>FastAPI service with request logging and health checks</span>
              </div>
              <div className="settings-status-enabled">Connected</div>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">About</div>
            <div className="about-card">
              <div className="about-icon">◈</div>
              <div className="about-details">
                <strong>NexusAI Workspace</strong>
                <span>Intelligent Pair Programming &amp; Research Assistant</span>
                <small>Release Version {version} (Production Build)</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
