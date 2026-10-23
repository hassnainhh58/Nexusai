import { useEffect, useRef, useState } from "react";

export default function Sidebar({
  open,
  onClose,
  conversations,
  conversationId,
  loading,
  hasMore,
  loadingList,
  onLoadMore,
  onNewChat,
  onSelect,
  onRename,
  onSetPinned,
  onDelete,
  onClearAll,
  searchTerm,
  onSearchTermChange,
  version,
}) {
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef(null);
  const skipBlurCommitRef = useRef(false);

  // Close the per-conversation menu when clicking anywhere else.
  useEffect(() => {
    if (openMenuId === null) return undefined;
    const close = () => setOpenMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  useEffect(() => {
    if (editingId !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const startEditing = (event, conversation) => {
    event.stopPropagation();
    setOpenMenuId(null);
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const commitEditing = async (id) => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title) return;
    const current = conversations.find((item) => item.id === id)?.title;
    if (title === current) return;
    await onRename(id, title);
  };

  const handleEditKeyDown = (event, id) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitEditing(id);
    }
    if (event.key === "Escape") {
      // Cancel: the blur handler must not save the discarded title.
      skipBlurCommitRef.current = true;
      setEditingId(null);
      setEditingTitle("");
    }
  };

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
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
          onClick={onClose}
          aria-label="Close sidebar"
          type="button"
        >
          ×
        </button>
      </div>

      <button
        className="new-chat-button"
        onClick={onNewChat}
        disabled={loading}
        type="button"
      >
        <span className="new-chat-icon">+</span>
        <span className="new-chat-label">New Chat</span>
        <span className="new-chat-shortcut">⌘K</span>
      </button>

      <div className="sidebar-search">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          className="sidebar-search-input"
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          placeholder="Search chats"
          aria-label="Search conversations"
          spellCheck="false"
        />
        {searchTerm ? (
          <button
            className="sidebar-search-clear"
            onClick={() => onSearchTermChange("")}
            aria-label="Clear search"
            title="Clear search"
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="conversation-section">
        <div className="section-title-row">
          <span className="section-title">CONVERSATIONS</span>
          <span className="section-count">{conversations.length}</span>
        </div>

        <div className="conversation-list">
          {conversations.length === 0 ? (
            searchTerm.trim() ? (
              <div className="empty-conversations">
                <span className="empty-icon">🔍</span>
                <span>No matches</span>
                <small>No chat matches “{searchTerm.trim()}”</small>
              </div>
            ) : (
              <div className="empty-conversations">
                <span className="empty-icon">💬</span>
                <span>No conversations yet</span>
                <small>Start asking questions to begin</small>
              </div>
            )
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`conversation-item ${
                  conversation.id === conversationId ? "active" : ""
                }${conversation.pinned ? " pinned" : ""}`}
              >
                {editingId === conversation.id ? (
                  <input
                    ref={editInputRef}
                    className="conversation-edit-input"
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => handleEditKeyDown(event, conversation.id)}
                    onBlur={() => commitEditing(conversation.id)}
                    aria-label="Conversation title"
                    maxLength={150}
                  />
                ) : (
                  <>
                    <button
                      className="conversation-open"
                      onClick={() => onSelect(conversation.id)}
                      disabled={loading}
                      type="button"
                    >
                      <span className="conversation-icon">◈</span>
                      <span className="conversation-title" title={conversation.title}>
                        {conversation.title}
                      </span>
                      {conversation.pinned ? (
                        <span className="conversation-pin" title="Pinned" aria-label="Pinned">
                          📌
                        </span>
                      ) : null}
                    </button>

                    <button
                      className="conversation-menu-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenMenuId((current) =>
                          current === conversation.id ? null : conversation.id
                        );
                      }}
                      disabled={loading}
                      title="Conversation options"
                      aria-label={`Options for ${conversation.title}`}
                      type="button"
                    >
                      ⋯
                    </button>

                    {openMenuId === conversation.id && (
                      <div
                        className="conversation-menu"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setOpenMenuId(null);
                            onSetPinned?.(conversation.id, !conversation.pinned);
                          }}
                          type="button"
                        >
                          <span className="menu-icon">{conversation.pinned ? "📌" : "📍"}</span>
                          <span>{conversation.pinned ? "Unpin" : "Pin"}</span>
                        </button>
                        <button
                          onClick={(event) => startEditing(event, conversation)}
                          type="button"
                        >
                          <span className="menu-icon">✏</span>
                          <span>Rename</span>
                        </button>
                        <button
                          className="delete-menu-item"
                          onClick={() => {
                            setOpenMenuId(null);
                            onDelete(conversation);
                          }}
                          type="button"
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

          {hasMore && (
            <button
              className="load-more-button"
              onClick={onLoadMore}
              disabled={loadingList}
              type="button"
            >
              {loadingList ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="status-indicator">
          <span className="status-dot"></span>
          <span className="status-label">NexusAI Core Online</span>
        </div>
        <div className="sidebar-footer-actions">
          {conversations.length > 0 && (
            <button
              className="clear-all-button"
              onClick={onClearAll}
              disabled={loading}
              type="button"
            >
              Clear all
            </button>
          )}
          <span className="version-tag">{version}</span>
        </div>
      </div>
    </aside>
  );
}
