import { useCallback, useEffect, useRef, useState } from "react";

import { readErrorMessage } from "../lib/api";
import { deriveTitle } from "../lib/format";

const PAGE_SIZE = 50;

function mergeById(primary, secondary) {
  const seen = new Set(primary.map((item) => item.id));
  return [...primary, ...secondary.filter((item) => !seen.has(item.id))];
}

function sortConversations(items) {
  return [...items].sort((first, second) => {
    if (Boolean(first.pinned) !== Boolean(second.pinned)) {
      return first.pinned ? -1 : 1;
    }
    const firstTime = new Date(first.updated_at || 0).getTime();
    const secondTime = new Date(second.updated_at || 0).getTime();
    if (firstTime !== secondTime) return secondTime - firstTime;
    return second.id - first.id;
  });
}

/** Conversation list: search, pagination, pinning and CRUD. */
export function useConversations({ apiFetch, notify }) {
  const [conversations, setConversations] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [query, setQuery] = useState("");

  const conversationsRef = useRef(conversations);
  const queryRef = useRef("");
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const requestPage = useCallback(
    async (searchTerm, offset) => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const cleaned = (searchTerm || "").trim();
      if (cleaned) params.set("q", cleaned);

      const response = await apiFetch(
        `/api/chat/conversations?${params.toString()}`
      );
      if (!response.ok) throw new Error(await readErrorMessage(response));
      return response.json();
    },
    [apiFetch]
  );

  const load = useCallback(
    async (searchTerm = "") => {
      setLoadingList(true);
      queryRef.current = searchTerm;
      setQuery(searchTerm);
      try {
        const page = await requestPage(searchTerm, 0);
        setConversations(page);
        setHasMore(page.length === PAGE_SIZE);
        return page;
      } catch (error) {
        notify?.("error", error.message || "Could not load conversations.");
        return [];
      } finally {
        setLoadingList(false);
      }
    },
    [requestPage, notify]
  );

  /** Searches titles and message contents on the server. */
  const search = useCallback((searchTerm) => load(searchTerm), [load]);

  const loadMore = useCallback(async () => {
    if (loadingList) return;
    setLoadingList(true);
    try {
      const page = await requestPage(queryRef.current, conversationsRef.current.length);
      setConversations((previous) => mergeById(previous, page));
      setHasMore(page.length === PAGE_SIZE);
    } catch (error) {
      notify?.("error", error.message || "Could not load more conversations.");
    } finally {
      setLoadingList(false);
    }
  }, [requestPage, loadingList, notify]);

  /** Inserts a conversation created by the stream without waiting for a reload. */
  const addLocal = useCallback((id, title) => {
    const now = new Date().toISOString();
    setConversations((previous) => {
      if (previous.some((item) => item.id === id)) return previous;
      return [
        {
          id,
          title: deriveTitle(title),
          pinned: false,
          created_at: now,
          updated_at: now,
        },
        ...previous,
      ];
    });
  }, []);

  const refreshAfterTurn = useCallback(async () => {
    try {
      const page = await requestPage(queryRef.current, 0);
      setConversations(page);
    } catch {
      // Sidebar sync is best-effort; the optimistic state is already correct.
    }
  }, [requestPage]);

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

  const setPinned = useCallback(
    async (id, pinned) => {
      const response = await apiFetch(`/api/chat/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setConversations((previous) =>
        sortConversations(
          previous.map((item) =>
            item.id === id ? { ...item, pinned } : item
          )
        )
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
    query,
    hasMore,
    loadingList,
    load,
    search,
    loadMore,
    addLocal,
    refreshAfterTurn,
    rename,
    setPinned,
    remove,
    clearAll,
    setConversations,
  };
}
