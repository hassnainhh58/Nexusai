import { useCallback, useRef, useState } from "react";

import { editImage as requestImageEdit, readErrorMessage } from "../lib/api";
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

function patchMessageById(messages, id, patch) {
  return messages.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function setLastRoleId(messages, role, id) {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index].role === role) {
      next[index] = { ...next[index], id };
      break;
    }
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
    async ({ message = "", regenerate = false, editMessageId = null, model = "" } = {}) => {
      if (loading) return;
      const targetId = conversationRef.current;
      if (regenerate && !targetId) return;
      if (editMessageId && !targetId) return;

      let streamedText = "";
      let modelUsed = "";

      setMessages((previous) => {
        const now = new Date().toISOString();
        const optimisticUser = { role: "user", content: message, created_at: now };
        const placeholder = {
          role: "assistant",
          content: "",
          created_at: now,
        };

        if (editMessageId) {
          const index = previous.findIndex((item) => item.id === editMessageId);
          const base = index >= 0 ? previous.slice(0, index) : previous;
          return [...base, optimisticUser, placeholder];
        }
        if (regenerate) {
          return [...dropTrailingAssistants(previous), placeholder];
        }
        return [...previous, optimisticUser, placeholder];
      });
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const payload = regenerate
          ? { conversation_id: targetId, regenerate: true }
          : { message, conversation_id: targetId };
        if (editMessageId) payload.edit_message_id = editMessageId;
        if (model) payload.model = model;

        const response = await apiFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
              if (data.user_message_id) {
                setMessages((previous) =>
                  setLastRoleId(previous, "user", data.user_message_id)
                );
              }
              return;
            }
            if (event === "token") {
              streamedText += data.text ?? "";
              setMessages((previous) =>
                replaceLastAssistant(previous, { content: streamedText })
              );
              return;
            }
            if (event === "done") {
              if (data.message_id) {
                setMessages((previous) =>
                  setLastRoleId(previous, "assistant", data.message_id)
                );
              }
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

  const sendMessage = useCallback(
    (message, model = "") => run({ message, model }),
    [run]
  );

  /** Edits an earlier user message and answers it again in place. */
  const editMessage = useCallback(
    (messageId, message, model = "") =>
      run({ message, editMessageId: messageId, model }),
    [run]
  );

  /**
   * Edits an uploaded image and appends the exchange to the transcript.
   *
   * The backend stores the edited picture (as a data URL inside markdown), so
   * the result is restored with the conversation.
   */
  const editImage = useCallback(
    async (file, prompt) => {
      if (loading || !file) return;
      const targetId = conversationRef.current;
      const previewUrl = URL.createObjectURL(file);

      setMessages((previous) => [
        ...previous,
        {
          role: "user",
          content: prompt,
          image: previewUrl,
          created_at: new Date().toISOString(),
        },
        { role: "assistant", content: "", created_at: new Date().toISOString() },
      ]);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await requestImageEdit(
          apiFetch,
          file,
          prompt,
          targetId,
          controller.signal
        );
        const id = Number(result.conversation_id);
        if (id && id !== targetId) {
          setConversation(id);
          onConversationCreated?.(id, prompt);
        }
        setModel(result.model || "");
        setMessages((previous) =>
          replaceLastAssistant(previous, {
            content: `![Edited image](${result.image})`,
            model: result.model,
          })
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          setMessages((previous) => finalizeStopped(previous, ""));
          return;
        }
        const failure = error?.message || "The image could not be edited.";
        setMessages((previous) =>
          replaceLastAssistant(previous, { content: "", error: failure })
        );
        notify?.("error", failure);
      } finally {
        abortRef.current = null;
        setLoading(false);
        onConversationTouched?.(conversationRef.current);
      }
    },
    [apiFetch, loading, notify, onConversationCreated, onConversationTouched, setConversation]
  );

  const regenerate = useCallback((model = "") => run({ regenerate: true, model }), [run]);

  /** Applies a local patch to a persisted message (e.g. feedback). */
  const updateMessage = useCallback((messageId, patch) => {
    setMessages((previous) => patchMessageById(previous, messageId, patch));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
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
    setConversation,
    load,
    reset,
  };
}
