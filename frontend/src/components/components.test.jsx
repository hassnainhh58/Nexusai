import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Composer from "./Composer.jsx";
import MessageList from "./MessageList.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import Sidebar from "./Sidebar.jsx";

const noop = () => {};

describe("workspace components", () => {
  it("renders search, pinned chats and the active conversation", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        open
        onClose={noop}
        conversations={[
          { id: 1, title: "Pinned chat", pinned: true },
          { id: 2, title: "Other chat", pinned: false },
        ]}
        conversationId={1}
        loading={false}
        hasMore={false}
        loadingList={false}
        onLoadMore={noop}
        onNewChat={noop}
        onSelect={noop}
        onRename={noop}
        onSetPinned={noop}
        onDelete={noop}
        onClearAll={noop}
        searchTerm="pin"
        onSearchTermChange={noop}
        version="v1.1.0"
      />
    );

    expect(html).toContain('placeholder="Search chats"');
    expect(html).toContain('value="pin"');
    expect(html).toContain("Pinned chat");
    expect(html).toContain("conversation-item active pinned");
  });

  it("shows long-message collapse, editing, feedback and timestamps", () => {
    const messages = [
      {
        id: 1,
        role: "user",
        content: "x".repeat(2100),
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        role: "assistant",
        content: "Answer",
        model: "test/model",
        feedback: "up",
        created_at: new Date().toISOString(),
      },
    ];

    const html = renderToStaticMarkup(
      <MessageList
        messages={messages}
        theme="dark"
        copiedId={null}
        onCopy={noop}
        onSuggestion={noop}
        onRegenerate={noop}
        onEdit={noop}
        onFeedback={noop}
        loading={false}
        canRegenerate
        endRef={{ current: null }}
        containerRef={{ current: null }}
        onScroll={noop}
      />
    );

    expect(html).toContain("Show full message");
    expect(html).toContain("Edit");
    expect(html).toContain("Regenerate");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("just now");
  });

  it("renders the model picker and shortcuts in settings", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        open
        onClose={noop}
        theme="dark"
        onToggleTheme={noop}
        model="a/b"
        models={[{ id: "a/b" }, { id: "c/d" }]}
        selectedModel="c/d"
        onModelChange={noop}
        version="v1.1.0"
      />
    );

    expect(html).toContain("Auto (server default)");
    expect(html).toContain('value="c/d"');
    expect(html).toContain("Ctrl / ⌘ + K");
  });

  it("renders the composer without dictation when unsupported", () => {
    const html = renderToStaticMarkup(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onStop={noop}
        loading={false}
        textareaRef={{ current: null }}
        file={null}
        onFileSelect={noop}
        onFileClear={noop}
        onAppendText={noop}
      />
    );

    expect(html).toContain("Ask anything");
    expect(html).not.toContain("Dictate a message");
  });
});
