"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HaroldShell } from "@/app/components/harold-shell";
import { useVisitor } from "@/app/hooks/use-visitor";
import type { ApiResponse } from "@/app/lib/api-types";
import type { MessageDto, MessagePageDto } from "@/app/lib/messages";

type ChatMessage = MessageDto & {
  status?: "pending" | "failed";
};

const MESSAGE_PAGE_SIZE = 30;

export default function Home() {
  const { isReady, visitorId, startNewChat } = useVisitor();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRefreshConfirmOpen, setIsRefreshConfirmOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingScrollRef = useRef<"bottom-instant" | "bottom-smooth" | null>(
    null,
  );
  const prependScrollRef = useRef<{
    previousScrollHeight: number;
    previousScrollTop: number;
  } | null>(null);
  const isLoadingOlderRef = useRef(false);

  const handleViewportChange = useCallback(() => {
    if (document.activeElement === draftRef.current) {
      scrollMessagesToBottom("auto");
    }
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    let isCancelled = false;

    async function loadMessages() {
      setIsLoading(true);
      setError(null);
      setHasMoreMessages(false);

      try {
        const page = await fetchMessagePage();

        if (!isCancelled) {
          pendingScrollRef.current = "bottom-instant";
          setMessages(page.messages);
          setHasMoreMessages(page.hasMore);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(getErrorMessage(loadError, "Could not load messages."));
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadMessages();

    return () => {
      isCancelled = true;
    };
  }, [isReady, visitorId]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleDocumentPointerDown(event: PointerEvent) {
      const menuElement = menuRef.current;
      const target = event.target;

      if (menuElement && target instanceof Node && menuElement.contains(target)) {
        return;
      }

      setIsMenuOpen(false);
    }

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isMenuOpen]);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const prependScroll = prependScrollRef.current;
    if (prependScroll) {
      prependScrollRef.current = null;
      scrollContainer.scrollTop =
        scrollContainer.scrollHeight -
        prependScroll.previousScrollHeight +
        prependScroll.previousScrollTop;
      return;
    }

    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll) {
      return;
    }

    pendingScrollRef.current = null;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: pendingScroll === "bottom-smooth" ? "smooth" : "auto",
    });
  }, [messages]);

  const trimmedDraft = useMemo(() => draft.trim(), [draft]);

  useLayoutEffect(() => {
    const textarea = draftRef.current;
    if (!textarea) {
      return;
    }

    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
    const maxHeight = lineHeight * 3 + 12;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendDraft();
  }

  async function sendDraft() {
    if (!isReady || !visitorId || trimmedDraft.length === 0) {
      return;
    }

    const optimisticId = `pending_${crypto.randomUUID()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      visitorId,
      role: "user",
      content: trimmedDraft,
      replyToId: null,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    setDraft("");
    setError(null);
    pendingScrollRef.current = "bottom-smooth";
    setMessages((currentMessages) => [...currentMessages, optimisticMessage]);

    try {
      const response = await fetch("/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ content: optimisticMessage.content }),
      });
      const payload = (await response.json()) as ApiResponse<MessageDto>;

      if (!payload.success) {
        throw new Error(payload.error);
      }

      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === optimisticId ? payload.data : message,
        ),
      );
    } catch (sendError) {
      setError(getErrorMessage(sendError, "Could not send message."));
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === optimisticId
            ? { ...message, status: "failed" }
            : message,
        ),
      );
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendDraft();
  }

  function handleDraftFocus() {
    scrollMessagesToBottom("auto");
    window.setTimeout(() => scrollMessagesToBottom("auto"), 150);
    window.setTimeout(() => scrollMessagesToBottom("auto"), 350);
  }

  function handleRefreshChat() {
    startNewChat();
    setMessages([]);
    setDraft("");
    setError(null);
    setIsMenuOpen(false);
    setIsRefreshConfirmOpen(false);
    setIsLoading(false);
    setIsLoadingOlder(false);
    setHasMoreMessages(false);
    pendingScrollRef.current = null;
    prependScrollRef.current = null;
    isLoadingOlderRef.current = false;
  }

  async function handleCopyVisitorId() {
    if (!visitorId) {
      return;
    }

    setIsMenuOpen(false);

    try {
      await navigator.clipboard.writeText(visitorId);
      showToast("Visitor ID copied");
    } catch {
      setError("Could not copy visitor ID.");
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 1800);
  }

  async function handleMessageScroll(event: UIEvent<HTMLElement>) {
    const scrollContainer = event.currentTarget;

    if (
      scrollContainer.scrollTop > 24 ||
      !hasMoreMessages ||
      isLoadingOlderRef.current ||
      isLoading ||
      messages.length === 0
    ) {
      return;
    }

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    setError(null);
    prependScrollRef.current = {
      previousScrollHeight: scrollContainer.scrollHeight,
      previousScrollTop: scrollContainer.scrollTop,
    };

    try {
      const oldestMessage = messages[0];
      const page = await fetchMessagePage(oldestMessage);
      setMessages((currentMessages) => [...page.messages, ...currentMessages]);
      setHasMoreMessages(page.hasMore);
    } catch (loadError) {
      prependScrollRef.current = null;
      setError(
        getErrorMessage(loadError, "Could not load older messages."),
      );
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }

  return (
    <HaroldShell
      title="Harold"
      onViewportChange={handleViewportChange}
      trailing={
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
            disabled={!isReady}
            className="harold-nav-button rounded-md px-3 py-1.5 text-[13px] font-bold leading-none transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            aria-label="Open menu"
          >
            More
          </button>
          {isMenuOpen ? (
            <div
              className="harold-menu absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-xl text-left text-[14px] font-bold text-slate-800"
              role="menu"
            >
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  setIsRefreshConfirmOpen(true);
                }}
                className="harold-menu-item"
                role="menuitem"
              >
                Refresh Chat
              </button>
              <button
                type="button"
                onClick={handleCopyVisitorId}
                className="harold-menu-item"
                role="menuitem"
              >
                Copy Visitor ID
              </button>
              <Link
                href="/about"
                className="harold-menu-item block"
                role="menuitem"
                onClick={() => setIsMenuOpen(false)}
              >
                About This Demo
              </Link>
            </div>
          ) : null}
        </div>
      }
    >
      <section
        ref={scrollContainerRef}
        data-message-scroll
        onScroll={handleMessageScroll}
        className="harold-chat-surface scrollbar-none flex-1 overflow-y-auto px-4 py-4"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm font-semibold leading-6 text-slate-500">
            Send the first message.
            <br />
            Harold will learn to answer in Phase 2.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {isLoadingOlder ? (
              <div className="pb-2 text-center text-xs font-semibold text-slate-500">
                Loading older messages...
              </div>
            ) : null}
            {!hasMoreMessages && messages.length >= MESSAGE_PAGE_SIZE ? (
              <div className="pb-2 text-center text-xs font-semibold text-slate-400">
                Start of chat
              </div>
            ) : null}
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </section>

      {error ? (
        <div className="border-t border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="harold-composer-bar flex items-end gap-2 px-2 py-2"
      >
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          onFocus={handleDraftFocus}
          disabled={!isReady}
          placeholder="Message"
          rows={1}
          className="harold-textbox scrollbar-none min-h-9 min-w-0 flex-1 resize-none rounded-[18px] px-4 py-1.5 text-base leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isReady || trimmedDraft.length === 0}
          className="harold-send-button rounded-full px-4 py-1.5 text-sm font-bold transition hover:brightness-105 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>

      {isRefreshConfirmOpen ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 px-8">
          <div className="harold-alert w-full max-w-[330px] overflow-hidden rounded-2xl text-center text-white">
            <div className="px-5 pb-5 pt-6">
              <h2 className="harold-title-shadow text-[22px] font-bold leading-tight">
                Refresh Chat
              </h2>
              <p className="mt-2 text-[15px] font-semibold leading-5 text-white/90">
                Start a fresh chat with a new visitor ID? Your old messages stay
                stored under the previous ID.
              </p>
            </div>
            <div className="grid grid-cols-2 border-t border-white/25">
              <button
                type="button"
                onClick={() => setIsRefreshConfirmOpen(false)}
                className="harold-alert-button border-r border-white/25"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRefreshChat}
                className="harold-alert-button font-extrabold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="absolute inset-x-0 bottom-20 z-40 flex justify-center px-4">
          <div className="harold-toast rounded-full px-4 py-2 text-sm font-bold text-white">
            {toastMessage}
          </div>
        </div>
      ) : null}
    </HaroldShell>
  );
}

function scrollMessagesToBottom(behavior: ScrollBehavior) {
  const scrollContainer = document.querySelector<HTMLElement>(
    "[data-message-scroll]",
  );
  if (!scrollContainer) {
    return;
  }

  scrollContainer.scrollTo({
    top: scrollContainer.scrollHeight,
    behavior,
  });
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`harold-bubble relative max-w-[78%] rounded-[18px] px-4 py-2 text-[16px] leading-5 ${
          isUser ? "harold-bubble-user" : "harold-bubble-harold"
        } ${message.status === "failed" ? "opacity-60" : ""}`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        {message.status ? (
          <p
            className={`mt-1 text-right text-[11px] font-semibold ${
              isUser ? "text-[#29566b]/70" : "text-slate-500"
            }`}
          >
            {message.status === "pending" ? "Sending..." : "Failed"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function fetchMessagePage(before?: MessageDto): Promise<MessagePageDto> {
  const params = new URLSearchParams({
    limit: String(MESSAGE_PAGE_SIZE),
  });

  if (before) {
    params.set("beforeCreatedAt", before.createdAt);
    params.set("beforeId", before.id);
  }

  const response = await fetch(`/api/messages?${params.toString()}`, {
    credentials: "same-origin",
  });
  const payload = (await response.json()) as ApiResponse<MessagePageDto>;

  if (!payload.success) {
    throw new Error(payload.error);
  }

  return payload.data;
}
