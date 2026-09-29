import {
  useEffect,
  useRef,
  useState,
} from "react";

import { Show, UserButton } from "@clerk/react";

import ReactMarkdown from "react-markdown";

import LandingPage from "./components/LandingPage.jsx";

const API_URL = "http://127.0.0.1:8000";

function App() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [conversations, setConversations] =
    useState([]);

  const [conversationId, setConversationId] =
    useState(null);

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  const [theme, setTheme] = useState(() => {
    return (
      localStorage.getItem(
        "nexusai-theme"
      ) || "dark"
    );
  });

  // ==========================================
  // CONVERSATION MENU
  // ==========================================

  const [openMenuId, setOpenMenuId] =
    useState(null);

  const [
    editingConversationId,
    setEditingConversationId,
  ] = useState(null);

  const [editingTitle, setEditingTitle] =
    useState("");

  // ==========================================
  // DELETE / EDIT NOTIFICATION
  // ==========================================

  const [notification, setNotification] =
    useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const editInputRef = useRef(null);

  // ==========================================
  // SAVE THEME
  // ==========================================

  useEffect(() => {
    localStorage.setItem(
      "nexusai-theme",
      theme
    );
  }, [theme]);

  // ==========================================
  // AUTO HIDE NOTIFICATION
  // ==========================================

  useEffect(() => {
    if (!notification) {
      return;
    }

    const timer = setTimeout(() => {
      setNotification(null);
    }, 3000);

    return () => clearTimeout(timer);
  }, [notification]);

  // ==========================================
  // AUTO FOCUS EDIT INPUT
  // ==========================================

  useEffect(() => {
    if (editingConversationId !== null) {
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    }
  }, [editingConversationId]);

  // ==========================================
  // CLOSE MENU WHEN CLICKING OUTSIDE
  // ==========================================

  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    if (openMenuId !== null) {
      document.addEventListener(
        "click",
        handleClickOutside
      );
    }

    return () => {
      document.removeEventListener(
        "click",
        handleClickOutside
      );
    };
  }, [openMenuId]);

  // ==========================================
  // AUTO SCROLL
  // ==========================================

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, loading]);

  // ==========================================
  // LOAD CONVERSATIONS
  // ==========================================

  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/chat/conversations`
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversations"
        );
      }

      const data = await response.json();

      setConversations(data);
    } catch (error) {
      console.error(
        "Could not load conversations:",
        error
      );
    }
  };

  // ==========================================
  // LOAD ONE CONVERSATION
  // ==========================================

  const loadConversation = async (id) => {
    if (loading) return;

    setOpenMenuId(null);

    try {
      const response = await fetch(
        `${API_URL}/api/chat/conversations/${id}`
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversation"
        );
      }

      const data = await response.json();

      setConversationId(id);
      setMessages(data.messages || []);

    } catch (error) {
      console.error(
        "Could not load conversation:",
        error
      );
    }
  };

  // ==========================================
  // OPEN CONVERSATION MENU
  // ==========================================

  const toggleConversationMenu = (
    event,
    id
  ) => {
    event.stopPropagation();

    setOpenMenuId((currentId) =>
      currentId === id ? null : id
    );
  };

  // ==========================================
  // START EDITING TITLE
  // ==========================================

  const startEditingConversation = (
    event,
    conversation
  ) => {
    event.stopPropagation();

    setOpenMenuId(null);

    setEditingConversationId(
      conversation.id
    );

    setEditingTitle(
      conversation.title
    );
  };

  // ==========================================
  // SAVE EDITED TITLE
  // ==========================================

  const saveConversationTitle = async (
    id
  ) => {
    const trimmedTitle =
      editingTitle.trim();

    if (!trimmedTitle) {
      setEditingTitle(
        conversations.find(
          (conversation) =>
            conversation.id === id
        )?.title || ""
      );

      setEditingConversationId(null);

      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/chat/conversations/${id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            title: trimmedTitle,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to update conversation title"
        );
      }

      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                title: trimmedTitle,
              }
            : conversation
        )
      );

      setEditingConversationId(null);
      setEditingTitle("");

      setNotification({
        type: "success",
        message:
          "Conversation renamed",
      });

    } catch (error) {
      console.error(
        "Could not rename conversation:",
        error
      );

      setNotification({
        type: "error",
        message:
          "Could not rename conversation",
      });
    }
  };

  // ==========================================
  // EDIT TITLE KEYBOARD
  // ==========================================

  const handleEditKeyDown = (
    event,
    id
  ) => {
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

    const conversation =
      conversations.find(
        (item) => item.id === id
      );

    const confirmed = window.confirm(
      `Delete "${
        conversation?.title ||
        "this conversation"
      }"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/api/chat/conversations/${id}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to delete conversation"
        );
      }

      setConversations((prev) =>
        prev.filter(
          (conversation) =>
            conversation.id !== id
        )
      );

      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
        setMessage("");
      }

      setNotification({
        type: "success",
        message:
          "Conversation deleted",
      });

    } catch (error) {
      console.error(
        "Could not delete conversation:",
        error
      );

      setNotification({
        type: "error",
        message:
          "Could not delete conversation",
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

    textareaRef.current?.focus();
  };

  // ==========================================
  // SEND MESSAGE
  // ==========================================

  const sendMessage = async () => {
    const trimmedMessage =
      message.trim();

    if (!trimmedMessage || loading) {
      return;
    }

    const userMessage = {
      role: "user",
      content: trimmedMessage,
    };

    setMessages((prev) => [
      ...prev,
      userMessage,
    ]);

    setMessage("");
    setLoading(true);

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "",
      },
    ]);

    try {
      const response = await fetch(
        `${API_URL}/api/chat`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            message: trimmedMessage,
            conversation_id:
              conversationId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to get response from NexusAI"
        );
      }

      const returnedConversationId =
        response.headers.get(
          "X-Conversation-ID"
        );

      if (returnedConversationId) {
        setConversationId(
          Number(
            returnedConversationId
          )
        );
      }

      if (!response.body) {
        throw new Error(
          "Response body is empty"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder("utf-8");

      let fullResponse = "";

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(value, {
            stream: true,
          });

        fullResponse += chunk;

        setMessages((prev) => {
          const updated = [...prev];

          const lastIndex =
            updated.length - 1;

          if (
            updated[lastIndex] &&
            updated[lastIndex].role ===
              "assistant"
          ) {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: fullResponse,
            };
          }

          return updated;
        });
      }

      const finalChunk =
        decoder.decode();

      if (finalChunk) {
        fullResponse += finalChunk;

        setMessages((prev) => {
          const updated = [...prev];

          const lastIndex =
            updated.length - 1;

          if (
            updated[lastIndex] &&
            updated[lastIndex].role ===
              "assistant"
          ) {
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
      console.error(
        "Chat request failed:",
        error
      );

      setMessages((prev) => {
        const updated = [...prev];

        const lastIndex =
          updated.length - 1;

        if (
          updated[lastIndex] &&
          updated[lastIndex].role ===
            "assistant"
        ) {
          updated[lastIndex] = {
            ...updated[lastIndex],
            content:
              "Sorry, something went wrong while processing your request.",
          };
        }

        return updated;
      });

    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // ENTER / SHIFT + ENTER
  // ==========================================

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      sendMessage();
    }
  };

  // ==========================================
  // THEME TOGGLE
  // ==========================================

  const toggleTheme = () => {
    setTheme((currentTheme) =>
      currentTheme === "dark"
        ? "light"
        : "dark"
    );
  };

  // ==========================================
  // UI
  // ==========================================

  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>

      <Show when="signed-in">
    <div
      className={`app ${theme}-theme`}
    >

      {/* ======================================
          NOTIFICATION
      ====================================== */}

      {notification && (
        <div
          className={`notification-banner ${
            notification.type
          }`}
        >
          <span className="notification-icon">
            {notification.type ===
            "success"
              ? "✓"
              : "!"}
          </span>

          <span>
            {notification.message}
          </span>

          <button
            onClick={() =>
              setNotification(null)
            }
          >
            ×
          </button>
        </div>
      )}


      {/* ======================================
          SIDEBAR
      ====================================== */}

      <aside className="sidebar">

        <div className="sidebar-header">

          <div className="brand">

            <div className="brand-icon">
              N
            </div>

            <div>

              <div className="brand-name">
                NexusAI
              </div>

              <div className="brand-subtitle">
                AI Assistant
              </div>

            </div>

          </div>

        </div>


        <button
          className="new-chat-button"
          onClick={startNewChat}
          disabled={loading}
        >

          <span className="new-chat-icon">
            +
          </span>

          <span>
            New Chat
          </span>

        </button>


        <div className="conversation-section">

          <div className="section-title">
            Conversations
          </div>


          <div className="conversation-list">

            {conversations.length === 0 ? (

              <div className="empty-conversations">
                No conversations yet
              </div>

            ) : (

              conversations.map(
                (conversation) => (

                  <div
                    key={conversation.id}
                    className={`conversation-item ${
                      conversation.id ===
                      conversationId
                        ? "active"
                        : ""
                    }`}
                  >

                    {editingConversationId ===
                    conversation.id ? (

                      <input
                        ref={editInputRef}
                        className="conversation-edit-input"
                        value={editingTitle}
                        onChange={(event) =>
                          setEditingTitle(
                            event.target.value
                          )
                        }
                        onKeyDown={(event) =>
                          handleEditKeyDown(
                            event,
                            conversation.id
                          )
                        }
                        onBlur={() =>
                          saveConversationTitle(
                            conversation.id
                          )
                        }
                      />

                    ) : (

                      <>

                        <button
                          className="conversation-open"
                          onClick={() =>
                            loadConversation(
                              conversation.id
                            )
                          }
                          disabled={loading}
                        >

                          <span className="conversation-icon">
                            ◈
                          </span>

                          <span className="conversation-title">
                            {conversation.title}
                          </span>

                        </button>


                        <button
                          className="conversation-menu-button"
                          onClick={(event) =>
                            toggleConversationMenu(
                              event,
                              conversation.id
                            )
                          }
                          disabled={loading}
                          title="Conversation options"
                        >
                          ⋯
                        </button>


                        {openMenuId ===
                          conversation.id && (

                          <div
                            className="conversation-menu"
                            onClick={(event) =>
                              event.stopPropagation()
                            }
                          >

                            <button
                              onClick={(event) =>
                                startEditingConversation(
                                  event,
                                  conversation
                                )
                              }
                            >

                              <span>
                                ✏
                              </span>

                              Edit

                            </button>


                            <button
                              className="delete-menu-item"
                              onClick={() =>
                                deleteChat(
                                  conversation.id
                                )
                              }
                            >

                              <span>
                                🗑
                              </span>

                              Delete

                            </button>

                          </div>

                        )}

                      </>

                    )}

                  </div>

                )
              )

            )}

          </div>

        </div>


        <div className="sidebar-footer">

          <div className="status-indicator">

            <span className="status-dot"></span>

            NexusAI Online

          </div>

        </div>

      </aside>


      {/* ======================================
          MAIN CHAT
      ====================================== */}

      <main className="chat-area">

        <header className="chat-header">

          <div>

            <div className="chat-title">
              NexusAI
            </div>

            <div className="chat-subtitle">
              Your intelligent AI assistant
            </div>

          </div>


          <div className="header-actions">

            <UserButton afterSignOutUrl="/" />

            <button
              className="settings-button"
              title="Settings"
              onClick={() =>
                setSettingsOpen(true)
              }
            >
              ⚙
            </button>

          </div>

        </header>


        {/* ====================================
            MESSAGES
        ==================================== */}

        <div className="messages-container">

          {messages.length === 0 ? (

            <div className="welcome-screen">

              <div className="welcome-icon">
                N
              </div>

              <h1>
                Welcome to NexusAI
              </h1>

              <p>
                Your professional AI
                assistant for knowledge,
                research, calculations,
                and more.
              </p>


              <div className="suggestion-grid">

                <button
                  onClick={() =>
                    setMessage(
                      "What can you help me with?"
                    )
                  }
                >

                  <strong>
                    Explore
                  </strong>

                  <span>
                    What can you help me with?
                  </span>

                </button>


                <button
                  onClick={() =>
                    setMessage(
                      "What is the latest version of Python?"
                    )
                  }
                >

                  <strong>
                    Search
                  </strong>

                  <span>
                    Find current information
                  </span>

                </button>


                <button
                  onClick={() =>
                    setMessage(
                      "What is 125 * 48?"
                    )
                  }
                >

                  <strong>
                    Calculate
                  </strong>

                  <span>
                    Solve a mathematical problem
                  </span>

                </button>


                <button
                  onClick={() =>
                    setMessage(
                      "Explain Python variables simply."
                    )
                  }
                >

                  <strong>
                    Learn
                  </strong>

                  <span>
                    Explain a technical concept
                  </span>

                </button>

              </div>

            </div>

          ) : (

            <div className="messages">

              {messages.map(
                (item, index) => (

                  <div
                    key={index}
                    className={`message-row ${
                      item.role === "user"
                        ? "user-row"
                        : "assistant-row"
                    }`}
                  >

                    <div
                      className={`message ${
                        item.role === "user"
                          ? "user-message"
                          : "assistant-message"
                      }`}
                    >

                      {item.role ===
                      "assistant" ? (

                        item.content ? (

                          <ReactMarkdown>
                            {item.content}
                          </ReactMarkdown>

                        ) : (

                          <div className="typing">

                            <span></span>
                            <span></span>
                            <span></span>

                          </div>

                        )

                      ) : (

                        <div>
                          {item.content}
                        </div>

                      )}

                    </div>

                  </div>

                )
              )}

              <div
                ref={messagesEndRef}
              />

            </div>

          )}

        </div>


        {/* ====================================
            INPUT
        ==================================== */}

        <div className="input-wrapper">

          <div className="input-area">

            <textarea
              ref={textareaRef}
              value={message}
              onChange={(event) =>
                setMessage(
                  event.target.value
                )
              }
              onKeyDown={handleKeyDown}
              placeholder="Ask NexusAI anything..."
              rows={1}
              disabled={loading}
            />

            <button
              className="send-button"
              onClick={sendMessage}
              disabled={
                loading ||
                !message.trim()
              }
              title="Send message"
            >
              ➤
            </button>

          </div>


          <div className="input-hint">
            Enter to send · Shift + Enter
            for a new line
          </div>

        </div>

      </main>


      {/* ======================================
          SETTINGS
      ====================================== */}

      {settingsOpen && (

        <div
          className="settings-overlay"
          onClick={() =>
            setSettingsOpen(false)
          }
        >

          <div
            className="settings-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <div className="settings-header">

              <div>

                <h2>
                  Settings
                </h2>

                <p>
                  NexusAI configuration
                </p>

              </div>


              <button
                className="settings-close"
                onClick={() =>
                  setSettingsOpen(false)
                }
              >
                ×
              </button>

            </div>


            <div className="settings-content">

              <div className="settings-section">

                <div className="settings-section-title">
                  Appearance
                </div>


                <div className="settings-row">

                  <div>

                    <strong>
                      Theme
                    </strong>

                    <span>
                      Choose how NexusAI looks
                    </span>

                  </div>


                  <button
                    className="theme-toggle"
                    onClick={toggleTheme}
                  >

                    <span>
                      {theme === "dark"
                        ? "🌙"
                        : "☀️"}
                    </span>

                    <span>
                      {theme === "dark"
                        ? "Dark"
                        : "Light"}
                    </span>

                  </button>

                </div>

              </div>


              <div className="settings-section">

                <div className="settings-section-title">
                  AI Assistant
                </div>


                <div className="settings-row">

                  <div>

                    <strong>
                      Model
                    </strong>

                    <span>
                      Current language model
                    </span>

                  </div>

                  <div className="settings-value">
                    Grok
                  </div>

                </div>


                <div className="settings-row">

                  <div>

                    <strong>
                      Web Search
                    </strong>

                    <span>
                      Current information lookup
                    </span>

                  </div>

                  <div className="settings-status">
                    Enabled
                  </div>

                </div>


                <div className="settings-row">

                  <div>

                    <strong>
                      Calculator
                    </strong>

                    <span>
                      Mathematical calculations
                    </span>

                  </div>

                  <div className="settings-status">
                    Enabled
                  </div>

                </div>

              </div>


              <div className="settings-section">

                <div className="settings-section-title">
                  System
                </div>


                <div className="settings-row">

                  <div>

                    <strong>
                      Backend
                    </strong>

                    <span>
                      NexusAI API server
                    </span>

                  </div>

                  <div className="settings-status">
                    Online
                  </div>

                </div>

              </div>


              <div className="settings-section">

                <div className="settings-section-title">
                  About
                </div>


                <div className="about-nexus">

                  <div className="about-icon">
                    N
                  </div>

                  <div>

                    <strong>
                      NexusAI
                    </strong>

                    <span>
                      Professional AI Assistant
                    </span>

                    <small>
                      Version 1.0.0
                    </small>

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