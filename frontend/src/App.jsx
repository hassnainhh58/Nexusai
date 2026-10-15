import { useCallback, useEffect, useRef, useState } from "react";
import { Show, UserButton } from "@clerk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism/index.js";

import LandingPage from "./components/LandingPage.jsx";

const API_URL = "http://127.0.0.1:8000";

// ==========================================
// CODE BLOCK COMPONENT
// ==========================================
function CodeBlock({ language, code, theme }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  const displayLang = language && language !== "code" && language !== "text" ? language : "code";

  return (
    <div className="code-block-card">
      <div className="code-block-header">
        <span className="code-language-tag">{displayLang.toUpperCase()}</span>
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
              <svg className="copy-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <div className="code-block-body">
        <SyntaxHighlighter
          language={language || "text"}
          style={theme === "dark" ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: "16px",
            background: "transparent",
            fontSize: "13.5px",
            lineHeight: "1.6",
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
          }}
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("nexusai-theme") || "dark";
  });

  // Conversation menu states
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingConversationId, setEditingConversationId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  // Notification state
  const [notification, setNotification] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const editInputRef = useRef(null);

  // ==========================================
  // LOAD CONVERSATIONS (Declared early)
  // ==========================================
  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/chat/conversations`);
      if (!response.ok) {
        throw new Error("Failed to load conversations");
      }
      const data = await response.json();
      setConversations(data);
    } catch (error) {
      console.error("Could not load conversations:", error);
    }
  }, []);

  // Save theme to localStorage
  useEffect(() => {
    localStorage.setItem("nexusai-theme", theme);
  }, [theme]);

  // Auto-hide notifications
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  // Focus conversation title edit input
  useEffect(() => {
    if (editingConversationId !== null) {
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingConversationId]);

  // Close conversation menu on outside click
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
    };
    if (openMenuId !== null) {
      document.addEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, [openMenuId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    async function fetchInitialConversations() {
      try {
        const response = await fetch(`${API_URL}/api/chat/conversations`);
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted) {
          setConversations(data);
        }
      } catch (error) {
        console.error("Could not load conversations:", error);
      }
    }
    fetchInitialConversations();
    return () => {
      isMounted = false;
    };
  }, []);

  // ==========================================
  // COPY HELPER
  // ==========================================
  const copyToClipboard = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // ==========================================
  // LOAD ONE CONVERSATION
  // ==========================================
  const loadConversation = async (id) => {
    if (loading) return;
    setOpenMenuId(null);
    setSidebarOpen(false); // Close sidebar on mobile upon selecting chat

    try {
      const response = await fetch(`${API_URL}/api/chat/conversations/${id}`);
      if (!response.ok) {
        throw new Error("Failed to load conversation");
      }
      const data = await response.json();
      setConversationId(id);
      setMessages(data.messages || []);
    } catch (error) {
      console.error("Could not load conversation:", error);
    }
  };

  // ==========================================
  // CONVERSATION MENU & EDIT
  // ==========================================
  const toggleConversationMenu = (event, id) => {
    event.stopPropagation();
    setOpenMenuId((currentId) => (currentId === id ? null : id));
  };

  const startEditingConversation = (event, conversation) => {
    event.stopPropagation();
    setOpenMenuId(null);
    setEditingConversationId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const saveConversationTitle = async (id) => {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) {
      setEditingTitle(conversations.find((c) => c.id === id)?.title || "");
      setEditingConversationId(null);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle }),
      });

      if (!response.ok) {
        throw new Error("Failed to update conversation title");
      }

      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: trimmedTitle } : c))
      );
      setEditingConversationId(null);
      setEditingTitle("");
      setNotification({
        type: "success",
        message: "Conversation renamed successfully",
      });
    } catch (error) {
      console.error("Could not rename conversation:", error);
      setNotification({
        type: "error",
        message: "Could not rename conversation",
      });
    }
  };

  const handleEditKeyDown = (event, id) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveConversationTitle(id);
    }
    if (event.key === "Escape") {
      setEditingConversationId(null);
      setEditingTitle("");
    }
  };

  // ==========================================
  // DELETE CONVERSATION
  // ==========================================
  const deleteChat = async (id) => {
    if (loading) return;
    setOpenMenuId(null);

    const targetConv = conversations.find((item) => item.id === id);
    const confirmed = window.confirm(
      `Delete "${targetConv?.title || "this conversation"}"?`
    );
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_URL}/api/chat/conversations/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete conversation");
      }

      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
        setMessage("");
      }
      setNotification({
        type: "success",
        message: "Conversation deleted",
      });
    } catch (error) {
      console.error("Could not delete conversation:", error);
      setNotification({
        type: "error",
        message: "Could not delete conversation",
      });
    }
  };

  // ==========================================
  // NEW CHAT
  // ==========================================
  const startNewChat = () => {
    if (loading) return;
    setConversationId(null);
    setMessages([]);
    setMessage("");
    setOpenMenuId(null);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  };

  // ==========================================
  // SEND MESSAGE
  // ==========================================
  const sendMessage = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || loading) return;

    const userMessage = {
      role: "user",
      content: trimmedMessage,
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setLoading(true);

    // Initial placeholder for assistant streaming
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "",
      },
    ]);

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response from NexusAI");
      }

      const returnedConversationId = response.headers.get("X-Conversation-ID");
      if (returnedConversationId) {
        setConversationId(Number(returnedConversationId));
      }

      if (!response.body) {
        throw new Error("Response body is empty");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullResponse = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;

        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex] && updated[lastIndex].role === "assistant") {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: fullResponse,
            };
          }
          return updated;
        });
      }

      const finalChunk = decoder.decode();
      if (finalChunk) {
        fullResponse += finalChunk;
        setMessages((prev) => {
          const updated = [...prev];
          const lastIndex = updated.length - 1;
          if (updated[lastIndex] && updated[lastIndex].role === "assistant") {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: fullResponse,
            };
          }
          return updated;
        });
      }

      await loadConversations();
    } catch (error) {
      console.error("Chat request failed:", error);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIndex = updated.length - 1;
        if (updated[lastIndex] && updated[lastIndex].role === "assistant") {
          updated[lastIndex] = {
            ...updated[lastIndex],
            content: "Sorry, something went wrong while processing your request. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  // Keyboard shortcut to send
  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };



  // Theme toggle
  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  // Current active conversation title
  const currentConversation = conversations.find((c) => c.id === conversationId);

  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>

      <Show when="signed-in">
        <div className={`app ${theme}-theme`}>
          {/* ======================================
              NOTIFICATION BANNER
          ====================================== */}
          {notification && (
            <div className={`notification-banner ${notification.type}`}>
              <span className="notification-icon">
                {notification.type === "success" ? "✓" : "!"}
              </span>
              <span className="notification-text">{notification.message}</span>
              <button
                className="notification-close"
                onClick={() => setNotification(null)}
                aria-label="Close notification"
              >
                ×
              </button>
            </div>
          )}

          {/* Mobile backdrop */}
          {sidebarOpen && (
            <div
              className="sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* ======================================
              SIDEBAR
          ====================================== */}
          <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
            <div className="sidebar-header">
              <div className="brand">
                <div className="brand-icon">
                  <span>◈</span>
                </div>
                <div className="brand-info">
                  <div className="brand-name">NexusAI</div>
                  <div className="brand-subtitle">Intelligence Workspace</div>
                </div>
              </div>
              <button
                className="mobile-close-sidebar"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close sidebar"
              >
                ×
              </button>
            </div>

            <button
              className="new-chat-button"
              onClick={startNewChat}
              disabled={loading}
            >
              <span className="new-chat-icon">+</span>
              <span className="new-chat-label">New Chat</span>
              <span className="new-chat-shortcut">⌘K</span>
            </button>

            <div className="conversation-section">
              <div className="section-title-row">
                <span className="section-title">CONVERSATIONS</span>
                <span className="section-count">{conversations.length}</span>
              </div>

              <div className="conversation-list">
                {conversations.length === 0 ? (
                  <div className="empty-conversations">
                    <span className="empty-icon">💬</span>
                    <span>No conversations yet</span>
                    <small>Start asking questions to begin</small>
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`conversation-item ${
                        conv.id === conversationId ? "active" : ""
                      }`}
                    >
                      {editingConversationId === conv.id ? (
                        <input
                          ref={editInputRef}
                          className="conversation-edit-input"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => handleEditKeyDown(e, conv.id)}
                          onBlur={() => saveConversationTitle(conv.id)}
                        />
                      ) : (
                        <>
                          <button
                            className="conversation-open"
                            onClick={() => loadConversation(conv.id)}
                            disabled={loading}
                          >
                            <span className="conversation-icon">◈</span>
                            <span className="conversation-title" title={conv.title}>
                              {conv.title}
                            </span>
                          </button>

                          <button
                            className="conversation-menu-button"
                            onClick={(e) => toggleConversationMenu(e, conv.id)}
                            disabled={loading}
                            title="Conversation options"
                            aria-label="Options"
                          >
                            ⋯
                          </button>

                          {openMenuId === conv.id && (
                            <div
                              className="conversation-menu"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => startEditingConversation(e, conv)}
                              >
                                <span className="menu-icon">✏</span>
                                <span>Rename</span>
                              </button>
                              <button
                                className="delete-menu-item"
                                onClick={() => deleteChat(conv.id)}
                              >
                                <span className="menu-icon">🗑</span>
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sidebar-footer">
              <div className="status-indicator">
                <span className="status-dot"></span>
                <span className="status-label">NexusAI Core Online</span>
              </div>
              <span className="version-tag">v1.0.0</span>
            </div>
          </aside>

          {/* ======================================
              MAIN CHAT AREA
          ====================================== */}
          <main className="chat-area">
            {/* TOP HEADER */}
            <header className="chat-header">
              <div className="chat-header-left">
                <button
                  className="mobile-hamburger-button"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open sidebar"
                  title="Open sidebar"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>

                <div className="header-title-group">
                  <div className="chat-title">
                    {currentConversation ? currentConversation.title : "NexusAI Workspace"}
                  </div>
                  <div className="chat-badge-row">
                    <span className="model-badge">✦ Nexus Core</span>
                    <span className="engine-status">Active</span>
                  </div>
                </div>
              </div>

              <div className="header-actions">
                <button
                  className="header-theme-toggle"
                  onClick={toggleTheme}
                  title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </button>

                <button
                  className="settings-button"
                  title="Settings"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Open settings"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>

                <div className="user-button-wrapper">
                  <UserButton afterSignOutUrl="/" />
                </div>
              </div>
            </header>

            {/* ====================================
                MESSAGES CONTAINER
            ==================================== */}
            <div className="messages-container">
              {messages.length === 0 ? (
                <div className="welcome-screen">
                  <div className="welcome-hero-badge">
                    <span className="welcome-hero-icon">◈</span>
                  </div>

                  <h1 className="welcome-heading">Welcome to NexusAI</h1>
                  <p className="welcome-subheading">
                    Your professional AI assistant for research, logic, calculations, code development, and complex problem-solving.
                  </p>

                  <div className="suggestion-grid">
                    <button
                      className="suggestion-card"
                      onClick={() => setMessage("What can you help me with?")}
                    >
                      <div className="suggestion-card-header">
                        <span className="suggestion-icon">⚡</span>
                        <strong>Capabilities</strong>
                      </div>
                      <span className="suggestion-prompt">
                        What can you help me with across engineering & research?
                      </span>
                    </button>

                    <button
                      className="suggestion-card"
                      onClick={() => setMessage("What is the latest version of Python?")}
                    >
                      <div className="suggestion-card-header">
                        <span className="suggestion-icon">🔍</span>
                        <strong>Live Search</strong>
                      </div>
                      <span className="suggestion-prompt">
                        What is the latest version of Python and its key features?
                      </span>
                    </button>

                    <button
                      className="suggestion-card"
                      onClick={() => setMessage("What is 125 * 48?")}
                    >
                      <div className="suggestion-card-header">
                        <span className="suggestion-icon">🧮</span>
                        <strong>Calculator</strong>
                      </div>
                      <span className="suggestion-prompt">
                        Calculate 125 * 48 with step-by-step arithmetic.
                      </span>
                    </button>

                    <button
                      className="suggestion-card"
                      onClick={() => setMessage("Explain Python variables simply.")}
                    >
                      <div className="suggestion-card-header">
                        <span className="suggestion-icon">💡</span>
                        <strong>Concepts</strong>
                      </div>
                      <span className="suggestion-prompt">
                        Explain Python variables and memory management simply.
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="messages-feed">
                  {messages.map((item, index) => {
                    const messageId = `msg-${index}`;

                    if (item.role === "user") {
                      return (
                        <div key={index} className="message-turn user-turn">
                          <div className="user-message-container">
                            <div className="user-message-header">
                              <span className="user-badge">You</span>
                              <button
                                className="copy-action-btn"
                                onClick={() => copyToClipboard(item.content, messageId)}
                                title="Copy question"
                                type="button"
                              >
                                {copiedId === messageId ? (
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
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="user-message-text">{item.content}</div>
                          </div>
                        </div>
                      );
                    }

                    // Assistant response
                    return (
                      <div key={index} className="message-turn assistant-turn">
                        <div className="assistant-message-container">
                          <div className="assistant-message-header">
                            <div className="assistant-avatar">
                              <span>◈</span>
                            </div>
                            <div className="assistant-meta">
                              <span className="assistant-name">NexusAI</span>
                              <span className="assistant-role-pill">Nexus Core</span>
                            </div>
                            {item.content && (
                              <button
                                className="copy-action-btn"
                                onClick={() => copyToClipboard(item.content, messageId)}
                                title="Copy response"
                                type="button"
                              >
                                {copiedId === messageId ? (
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
                                    <span>Copy answer</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>

                          <div className="assistant-message-content">
                            {item.content ? (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
                                }}
                              >
                                {item.content}
                              </ReactMarkdown>
                            ) : (
                              <div className="typing-indicator-box">
                                <span className="typing-dot"></span>
                                <span className="typing-dot"></span>
                                <span className="typing-dot"></span>
                                <span className="typing-text">NexusAI is generating response...</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* ====================================
                INPUT AREA
            ==================================== */}
            <div className="input-wrapper">
              <div className="input-area-card">


                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask NexusAI anything... (research, code, math, logic)"
                  rows={1}
                  disabled={loading}
                />

                <button
                  className="send-button"
                  onClick={sendMessage}
                  disabled={loading || !message.trim()}
                  title="Send message (Enter)"
                  aria-label="Send message"
                >
                  {loading ? (
                    <span className="spinner-dots">●●●</span>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>

              <div className="input-hint-row">
                <span className="hint-pill">Press Enter ↵ to send</span>
                <span className="hint-divider">·</span>
                <span className="hint-pill">Shift + Enter for new line</span>
              </div>
            </div>
          </main>

          {/* ======================================
              SETTINGS MODAL
          ====================================== */}
          {settingsOpen && (
            <div
              className="settings-overlay"
              onClick={() => setSettingsOpen(false)}
            >
              <div
                className="settings-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="settings-header">
                  <div>
                    <h2>Settings & Preferences</h2>
                    <p>Configure NexusAI workspace appearance and tools</p>
                  </div>
                  <button
                    className="settings-close"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    ×
                  </button>
                </div>

                <div className="settings-content">
                  {/* Appearance */}
                  <div className="settings-section">
                    <div className="settings-section-title">Appearance</div>
                    <div className="settings-row">
                      <div>
                        <strong>Theme</strong>
                        <span>Select interface appearance mode</span>
                      </div>
                      <button
                        className="theme-toggle-btn"
                        onClick={toggleTheme}
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

                  {/* AI Capabilities */}
                  <div className="settings-section">
                    <div className="settings-section-title">AI Engine</div>
                    <div className="settings-row">
                      <div>
                        <strong>Active Model</strong>
                        <span>Current intelligence backbone</span>
                      </div>
                      <div className="settings-badge-value">Grok / Nexus Core</div>
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

                  {/* System & Backend */}
                  <div className="settings-section">
                    <div className="settings-section-title">System Health</div>
                    <div className="settings-row">
                      <div>
                        <strong>Backend Server</strong>
                        <span>FastAPI Local Service (127.0.0.1:8000)</span>
                      </div>
                      <div className="settings-status-enabled">Connected</div>
                    </div>
                  </div>

                  {/* About */}
                  <div className="settings-section">
                    <div className="settings-section-title">About</div>
                    <div className="about-card">
                      <div className="about-icon">◈</div>
                      <div className="about-details">
                        <strong>NexusAI Workspace</strong>
                        <span>Intelligent Pair Programming & Research Assistant</span>
                        <small>Release Version 1.0.0 (Production Build)</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Show>
    </>
  );
}

export default App;