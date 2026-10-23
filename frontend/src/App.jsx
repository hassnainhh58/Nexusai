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
import { createApiClient, readErrorMessage, uploadFile } from "./lib/api.js";
import { formatModelName } from "./lib/format.js";

const APP_VERSION = "v1.1.0";
const LAST_CONVERSATION_KEY = "nexusai-last-conversation";
const MODEL_KEY = "nexusai-model";
const NOTIFICATION_TIMEOUT = 4000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  const messagesContainerRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const restoredRef = useRef(false);
  const lastSearchRef = useRef("");

  const [input, setInput] = useState("");
  const [file, setFile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(MODEL_KEY) || ""
  );

  const notify = useCallback((type, message) => {
    setNotification({ type, message });
  }, []);

  // Releases the preview blob when an attachment is discarded.
  const clearAttachment = useCallback(() => {
    setFile((current) => {
      if (current?.kind === "image" && current.preview) {
        URL.revokeObjectURL(current.preview);
      }
      return null;
    });
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
    search: searchConversations,
    loadMore,
    addLocal,
    refreshAfterTurn,
    rename,
    setPinned,
    remove,
    clearAll,
  } = useConversations({ apiFetch, notify });

  const {
    messages,
    conversationId,
    model,
    loading,
    sendMessage,
    editMessage,
    editImage,
    regenerate,
    updateMessage,
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
        stickToBottomRef.current = true;
        setShowJumpToLatest(false);
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
    clearAttachment();
    setSidebarOpen(false);
    setSettingsOpen(false);
    setSearchTerm("");
    lastSearchRef.current = "";
    searchConversations("");
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    textareaRef.current?.focus();
  }, [loading, resetChat, clearAttachment, searchConversations]);

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

  // The model catalogue is optional: if the provider cannot be reached the
  // picker simply stays on "Auto" and the server default is used.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch("/v1/models");
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          const list = Array.isArray(data?.data) ? data.data : [];
          setModels(list);
          // A stored model that is no longer offered silently falls back to Auto.
          const stored = localStorage.getItem(MODEL_KEY);
          if (
            stored &&
            list.length > 0 &&
            !list.some((entry) => entry.id === stored)
          ) {
            setSelectedModel("");
            localStorage.removeItem(MODEL_KEY);
          }
        }
      } catch {
        // Non-fatal: the default model is always available.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, apiFetch]);

  const handleModelChange = useCallback((value) => {
    setSelectedModel(value);
    if (value) localStorage.setItem(MODEL_KEY, value);
    else localStorage.removeItem(MODEL_KEY);
  }, []);

  // Debounce the sidebar filter so typing costs one request, not one per key.
  useEffect(() => {
    const cleaned = searchTerm.trim();
    if (cleaned === lastSearchRef.current) return undefined;
    const timer = setTimeout(() => {
      lastSearchRef.current = cleaned;
      searchConversations(cleaned);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, searchConversations]);

  // Keep the newest message in view only while the user is already at the
  // bottom, so reading earlier turns is never interrupted by a stream.
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  const handleMessagesScroll = useCallback(() => {
    const element = messagesContainerRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distance < 140;
    setShowJumpToLatest(distance > 280);
  }, []);

  const scrollToLatest = useCallback(() => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // ---------------------------------------------------------------- actions
  const handleFileSelect = useCallback(
    async (picked) => {
      if (picked.type.startsWith("image/")) {
        if (!IMAGE_TYPES.has(picked.type)) {
          notify("error", "Unsupported image type. Use PNG, JPEG or WEBP.");
          return;
        }
        clearAttachment();
        setFile({
          kind: "image",
          file: picked,
          filename: picked.name,
          preview: URL.createObjectURL(picked),
        });
        return;
      }

      try {
        const info = await uploadFile(apiFetch, picked);
        setFile({ kind: "document", ...info });
      } catch (error) {
        notify("error", error.message || "Could not read the uploaded file.");
      }
    },
    [apiFetch, notify, clearAttachment]
  );

  const handleFileClear = clearAttachment;

  const handleSend = useCallback(() => {
    if (loading) return;
    const text = input.trim();

    // An image attachment means "edit this picture with the prompt".
    if (file?.kind === "image") {
      if (!text) return;
      const imageFile = file.file;
      clearAttachment();
      setInput("");
      editImage(imageFile, text);
      return;
    }

    let message = text;
    if (file) {
      // Attach the extracted document text to the turn, like a real file
      // upload in a chat product. The full text is sent: there is no
      // application-level character limit, and anything beyond the model's
      // context is reduced to the most relevant excerpts on the server.
      message = text
        ? `${text}\n\nAttached file: ${file.filename}\n${file.extracted_text}`
        : `Attached file: ${file.filename}\n${file.extracted_text}`;
      setFile(null);
    }

    if (!message.trim()) return;
    setInput("");
    stickToBottomRef.current = true;
    sendMessage(message, selectedModel);
  }, [input, loading, file, sendMessage, editImage, clearAttachment, selectedModel]);

  const handleSuggestion = useCallback((text) => {
    setInput(text);
    textareaRef.current?.focus();
  }, []);

  const handleAppendText = useCallback((text) => {
    setInput((previous) =>
      previous.trim() ? `${previous.trimEnd()} ${text}` : text
    );
    textareaRef.current?.focus();
  }, []);

  const handleEditMessage = useCallback(
    (messageId, text) => {
      if (!messageId) return;
      stickToBottomRef.current = true;
      editMessage(messageId, text, selectedModel);
    },
    [editMessage, selectedModel]
  );

  const handleRegenerate = useCallback(() => {
    stickToBottomRef.current = true;
    regenerate(selectedModel);
  }, [regenerate, selectedModel]);

  const handleFeedback = useCallback(
    async (messageId, feedback, previous = null) => {
      if (!conversationId) return;
      updateMessage(messageId, { feedback });
      try {
        const response = await apiFetch(
          `/api/chat/conversations/${conversationId}/messages/${messageId}/feedback`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback }),
          }
        );
        if (!response.ok) throw new Error(await readErrorMessage(response));
      } catch (error) {
        updateMessage(messageId, { feedback: previous });
        notify("error", error.message || "Could not save your feedback.");
      }
    },
    [apiFetch, conversationId, notify, updateMessage]
  );

  const handlePin = useCallback(
    async (id, pinned) => {
      try {
        await setPinned(id, pinned);
        notify("success", pinned ? "Conversation pinned" : "Conversation unpinned");
      } catch (error) {
        notify("error", error.message || "Could not update the conversation.");
      }
    },
    [setPinned, notify]
  );

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
      clearAttachment();
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
  }, [confirmAction, remove, conversationId, resetChat, clearAll, notify, clearAttachment]);

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
            onSetPinned={handlePin}
            onDelete={(conversation) =>
              setConfirmAction({ type: "delete", conversation })
            }
            onClearAll={() => setConfirmAction({ type: "clear" })}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
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
                    <select
                      className="model-picker"
                      value={selectedModel}
                      onChange={(event) => handleModelChange(event.target.value)}
                      title="Model used for new messages"
                      aria-label="Model used for new messages"
                    >
                      <option value="">Auto</option>
                      {models.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {formatModelName(entry.id)}
                        </option>
                      ))}
                    </select>
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
              onRegenerate={handleRegenerate}
              onEdit={handleEditMessage}
              onFeedback={handleFeedback}
              loading={loading}
              canRegenerate={Boolean(conversationId)}
              endRef={messagesEndRef}
              containerRef={messagesContainerRef}
              onScroll={handleMessagesScroll}
            />

            {showJumpToLatest ? (
              <button
                className="jump-to-latest"
                onClick={scrollToLatest}
                type="button"
                title="Scroll to the latest message"
              >
                ↓ Latest
              </button>
            ) : null}

            <Composer
              value={input}
              onChange={setInput}
              onSend={handleSend}
              onStop={stop}
              loading={loading}
              textareaRef={textareaRef}
              file={file}
              onFileSelect={handleFileSelect}
              onFileClear={handleFileClear}
              onAppendText={handleAppendText}
            />
          </main>

          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            theme={theme}
            onToggleTheme={toggleTheme}
            model={model}
            models={models}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
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
