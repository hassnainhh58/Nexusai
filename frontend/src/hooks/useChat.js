import { useCallback, useRef, useState } from "react";

import { readErrorMessage } from "../lib/api";
import { consumeSseResponse } from "../lib/sse";

export const PAGE_SIZE = 50;

function replaceLastAssistant(messages, patch) {
  const next = [...messages];
  const index = next.length - 1;
  if (index >= 0 && next[index].role === "assistant") {
    next[index] = { ...next[index], ...patch };
  }
  return next;
}

function dropTrailingAssistants(messages) {
  const next = [...messages];
  while (next.length > 0 && next[next.length - 1].role === "assistant") {
    next.pop();
  }
  return next;
}

function finalizeStopped(messages, text) {
  const next = [...messages];
  const index = next.length - 1;
  if (index < 0 || next[index].role !== "assistant") return next;

  if (!text.trim()) {
    // Nothing was generated: remove the empty placeholder.
    next.pop();
    return next;
  }
  next[index] = { ...next[index], content: text, stopped: true };
  return next;
}

/**
 * Owns the chat transcript and the streaming state machine.
 *
 * The backend speaks Server-Sent Events (meta / token / error / done); this
 * hook maps them onto message state and keeps the "Stop" button around an
 * AbortController.
 */
export function useChat({
  apiFetch,
  notify,
  onConversationCreated,
  onConversationTouched,
}) {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState("");

  const abortRef = useRef(null);
  const conversationRef = useRef(null);

  const setConversation = useCallback((id) => {
    const normalized = id === null || id === undefined ? null : Number(id);
    conversationRef.current = normalized;
    setConversationId(normalized);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setModel("");
    setConversation(null);
  }, [setConversation]);

  const load = useCallback(
    (id, loadedMessages) => {
      abortRef.current?.abort();
      abortRef.current = null;
      setConversation(id);
      setMessages(Array.isArray(loadedMessages) ? loadedMessages : []);
      setModel("");
    },
    [setConversation]
  );

  const run = useCallback(
    async ({ message = "", regenerate = false } = {}) => {
      if (loading) return;
      const targetId = conversationRef.current;
      if (regenerate && !targetId) return;

      let streamedText = "";
      let modelUsed = "";

      setMessages((previous) =>
        regenerate
          ? [...dropTrailingAssistants(previous), { role: "assistant", content: "" }]
          : [
              ...previous,
              { role: "user", content: message },
              { role: "assistant", content: "" },
            ]
      );
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await apiFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            regenerate
              ? { conversation_id: targetId, regenerate: true }
              : { message, conversation_id: targetId }
          ),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        const headerId = Number(response.headers.get("X-Conversation-ID"));
        if (headerId && headerId !== targetId) {
          setConversation(headerId);
          onConversationCreated?.(headerId, message);
        }

        await consumeSseResponse(response, {
          signal: controller.signal,
          onEvent: ({ event, data }) => {
            if (event === "meta") {
              modelUsed = data.model || "";
              setModel(modelUsed);
              return;
            }
            if (event === "token") {
              streamedText += data.text ?? "";
              setMessages((previous) =>
                replaceLastAssistant(previous, { content: streamedText })
              );
              return;
            }
            if (event === "error") {
              throw new Error(
                data.message || "The model could not complete the request."
              );
            }
          },
        });

        if (!streamedText.trim()) {
          throw new Error("The server returned an empty response.");
        }

        setMessages((previous) =>
          replaceLastAssistant(previous, {
            content: streamedText,
            model: modelUsed,
          })
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          setMessages((previous) => finalizeStopped(previous, streamedText));
        } else {
          const failure = error?.message || "Something went wrong.";
          setMessages((previous) =>
            replaceLastAssistant(previous, {
              content: streamedText,
              model: modelUsed,
              error: failure,
            })
          );
          notify?.("error", failure);
        }
      } finally {
        abortRef.current = null;
        setLoading(false);
        onConversationTouched?.(conversationRef.current);
      }
    },
    [apiFetch, loading, notify, onConversationCreated, onConversationTouched, setConversation]
  );

  const sendMessage = useCallback((message) => run({ message }), [run]);

  const regenerate = useCallback(() => run({ regenerate: true }), [run]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    conversationId,
    model,
    loading,
    sendMessage,
    regenerate,
    stop,
    setConversation,
    load,
    reset,
  };
}
