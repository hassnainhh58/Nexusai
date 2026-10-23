import { useCallback, useEffect, useRef, useState } from "react";

import { readErrorMessage } from "../lib/api";
import { deriveTitle } from "../lib/format";

const PAGE_SIZE = 50;

function mergeById(primary, secondary) {
  const seen = new Set(primary.map((item) => item.id));
  return [...primary, ...secondary.filter((item) => !seen.has(item.id))];
}

/** Conversation list: loading, pagination, optimistic insert and CRUD. */
export function useConversations({ apiFetch, notify }) {
  const [conversations, setConversations] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await apiFetch(
        `/api/chat/conversations?limit=${PAGE_SIZE}&offset=0`
      );
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const page = await response.json();
      setConversations(page);
      setHasMore(page.length === PAGE_SIZE);
      return page;
    } catch (error) {
      notify?.("error", error.message || "Could not load conversations.");
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [apiFetch, notify]);

  const loadMore = useCallback(async () => {
    if (loadingList) return;
    setLoadingList(true);
    try {
      const response = await apiFetch(
        `/api/chat/conversations?limit=${PAGE_SIZE}&offset=${conversationsRef.current.length}`
      );
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const page = await response.json();
      setConversations((previous) => mergeById(previous, page));
      setHasMore(page.length === PAGE_SIZE);
    } catch (error) {
      notify?.("error", error.message || "Could not load more conversations.");
    } finally {
      setLoadingList(false);
    }
  }, [apiFetch, loadingList, notify]);

  /** Inserts a conversation created by the stream without waiting for a reload. */
  const addLocal = useCallback((id, title) => {
    const now = new Date().toISOString();
    setConversations((previous) => {
      if (previous.some((item) => item.id === id)) return previous;
      return [
        { id, title: deriveTitle(title), created_at: now, updated_at: now },
        ...previous,
      ];
    });
  }, []);

  const refreshAfterTurn = useCallback(async () => {
    try {
      const response = await apiFetch(
        `/api/chat/conversations?limit=${PAGE_SIZE}&offset=0`
      );
      if (!response.ok) return;
      setConversations(await response.json());
    } catch {
      // Sidebar sync is best-effort; the optimistic state is already correct.
    }
  }, [apiFetch]);

  const rename = useCallback(
    async (id, title) => {
      const response = await apiFetch(`/api/chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setConversations((previous) =>
        previous.map((item) => (item.id === id ? { ...item, title } : item))
      );
    },
    [apiFetch]
  );

  const remove = useCallback(
    async (id) => {
      const response = await apiFetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setConversations((previous) => previous.filter((item) => item.id !== id));
    },
    [apiFetch]
  );

  const clearAll = useCallback(async () => {
    const response = await apiFetch("/api/chat/conversations", { method: "DELETE" });
    if (!response.ok) throw new Error(await readErrorMessage(response));
    setConversations([]);
    setHasMore(false);
  }, [apiFetch]);

  return {
    conversations,
    hasMore,
    loadingList,
    load,
    loadMore,
    addLocal,
    refreshAfterTurn,
    rename,
    remove,
    clearAll,
    setConversations,
  };
}
