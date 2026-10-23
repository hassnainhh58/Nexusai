import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Show, UserButton, useAuth } from "@clerk/react";

import Composer from "./components/Composer.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import LandingPage from "./components/LandingPage.jsx";
import MessageList from "./components/MessageList.jsx";
import Notification from "./components/Notification.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { useChat } from "./hooks/useChat.js";
import { useConversations } from "./hooks/useConversations.js";
import { useTheme } from "./hooks/useTheme.js";
import { createApiClient, readErrorMessage } from "./lib/api.js";
import { formatModelName } from "./lib/format.js";

const APP_VERSION = "v1.1.0";
const LAST_CONVERSATION_KEY = "nexusai-last-conversation";
const NOTIFICATION_TIMEOUT = 4000;

// Built outside the component so the ref is only dereferenced when a request
// is actually made, never during render.
function currentToken(ref, options) {
  return ref.current(options);
}

export default function App() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Kept in a ref so the client (and every callback built on it) stays stable
  // when Clerk re-creates `getToken`.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  const apiFetch = useMemo(
    // oxlint-disable-next-line react/refs -- the ref is only read when a request runs
    () => createApiClient((options) => currentToken(getTokenRef, options)),
    []
  );

  const textareaRef = useRef(null);
  const messagesEndRef = useRef(null);
  const restoredRef = useRef(false);

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const notify = useCallback((type, message) => {
    setNotification({ type, message });
  }, []);

  useEffect(() => {
    if (!notification) return undefined;
    const timer = setTimeout(() => setNotification(null), NOTIFICATION_TIMEOUT);
    return () => clearTimeout(timer);
  }, [notification]);

  const {
    conversations,
    hasMore,
    loadingList,
    load: loadConversations,
    loadMore,
    addLocal,
    refreshAfterTurn,
    rename,
    remove,
    clearAll,
  } = useConversations({ apiFetch, notify });

  const {
    messages,
    conversationId,
    model,
    loading,
    sendMessage,
    regenerate,
    stop,
    load: loadChat,
    reset: resetChat,
  } = useChat({
    apiFetch,
    notify,
    onConversationCreated: addLocal,
    onConversationTouched: refreshAfterTurn,
  });

  // ---------------------------------------------------------------- navigation
  const openConversation = useCallback(
    async (id) => {
      try {
        const response = await apiFetch(`/api/chat/conversations/${id}`);
        if (!response.ok) throw new Error(await readErrorMessage(response));
        const data = await response.json();
        loadChat(id, data.messages);
        localStorage.setItem(LAST_CONVERSATION_KEY, String(id));
      } catch (error) {
        notify?.("error", error.message || "Could not load the conversation.");
      }
    },
    [apiFetch, loadChat, notify]
  );

  const startNewChat = useCallback(() => {
    if (loading) return;
    resetChat();
    localStorage.removeItem(LAST_CONVERSATION_KEY);
    setInput("");
    setSidebarOpen(false);
    setSettingsOpen(false);
    textareaRef.current?.focus();
  }, [loading, resetChat]);

  // Initial load: wait for Clerk, then restore the last conversation.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    let cancelled = false;

    (async () => {
      const page = await loadConversations();
      if (cancelled || restoredRef.current) return;
      restoredRef.current = true;

      const stored = Number(localStorage.getItem(LAST_CONVERSATION_KEY));
      if (stored && page.some((conversation) => conversation.id === stored)) {
        await openConversation(stored);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, userId, loadConversations, openConversation]);

  // Close overlays / focus shortcuts.
  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        startNewChat();
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [startNewChat]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // ---------------------------------------------------------------- actions
  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    sendMessage(text);
  }, [input, loading, sendMessage]);

  const handleSuggestion = useCallback((text) => {
    setInput(text);
    textareaRef.current?.focus();
  }, []);

  const handleSelectConversation = useCallback(
    (id) => {
      if (loading) return;
      setSidebarOpen(false);
      openConversation(id);
    },
    [loading, openConversation]
  );

  const handleRename = useCallback(
    async (id, title) => {
      try {
        await rename(id, title);
        notify("success", "Conversation renamed successfully");
      } catch (error) {
        notify("error", error.message || "Could not rename the conversation.");
      }
    },
    [rename, notify]
  );

  const handleCopy = useCallback(
    async (text, messageId) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedId(messageId);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        notify("error", "Could not copy to the clipboard.");
      }
    },
    [notify]
  );

  const handleConfirm = useCallback(async () => {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;

    try {
      if (action.type === "delete") {
        await remove(action.conversation.id);
        if (conversationId === action.conversation.id) {
          resetChat();
          localStorage.removeItem(LAST_CONVERSATION_KEY);
        }
        notify("success", "Conversation deleted");
        return;
      }

      await clearAll();
      resetChat();
      localStorage.removeItem(LAST_CONVERSATION_KEY);
      notify("success", "All conversations were deleted");
    } catch (error) {
      notify("error", error.message || "The operation could not be completed.");
    }
  }, [confirmAction, remove, conversationId, resetChat, clearAll, notify]);

  const currentConversation = conversations.find(
    (conversation) => conversation.id === conversationId
  );

  return (
    <>
      <Show when="signed-out">
        <LandingPage />
      </Show>

      <Show when="signed-in">
        <div className={`app ${theme}-theme`}>
          <Notification
            notification={notification}
            onClose={() => setNotification(null)}
          />

          {sidebarOpen && (
            <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
          )}

          <Sidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            conversations={conversations}
            conversationId={conversationId}
            loading={loading}
            hasMore={hasMore}
            loadingList={loadingList}
            onLoadMore={loadMore}
            onNewChat={startNewChat}
            onSelect={handleSelectConversation}
            onRename={handleRename}
            onDelete={(conversation) =>
              setConfirmAction({ type: "delete", conversation })
            }
            onClearAll={() => setConfirmAction({ type: "clear" })}
            version={APP_VERSION}
          />

          <main className="chat-area">
            <header className="chat-header">
              <div className="chat-header-left">
                <button
                  className="mobile-hamburger-button"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open sidebar"
                  title="Open sidebar"
                  type="button"
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
                    <span className="model-badge">✦ {formatModelName(model)}</span>
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
                  type="button"
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
                  type="button"
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

            <MessageList
              messages={messages}
              theme={theme}
              copiedId={copiedId}
              onCopy={handleCopy}
              onSuggestion={handleSuggestion}
              onRegenerate={regenerate}
              loading={loading}
              canRegenerate={Boolean(conversationId)}
              endRef={messagesEndRef}
            />

            <Composer
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={stop}
              loading={loading}
              textareaRef={textareaRef}
            />
          </main>

          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            theme={theme}
            onToggleTheme={toggleTheme}
            model={model}
            version={APP_VERSION}
          />

          <ConfirmDialog
            open={confirmAction !== null}
            title={
              confirmAction?.type === "clear"
                ? "Delete all conversations?"
                : "Delete this conversation?"
            }
            description={
              confirmAction?.type === "clear"
                ? "Every conversation in your workspace will be permanently removed. This cannot be undone."
                : `"${confirmAction?.conversation?.title ?? ""}" and all of its messages will be permanently removed.`
            }
            confirmLabel="Delete"
            danger
            onConfirm={handleConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        </div>
      </Show>
    </>
  );
}
