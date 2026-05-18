"use client";

import {
  FormEvent,
  KeyboardEvent,
  UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [currentTime, setCurrentTime] = useState("");
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

  useEffect(() => {
    function updateClock() {
      setCurrentTime(
        new Intl.DateTimeFormat(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date()),
      );
    }

    updateClock();
    const intervalId = window.setInterval(updateClock, 30_000);

    return () => window.clearInterval(intervalId);
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

  function handleNewChat() {
    startNewChat();
    setMessages([]);
    setDraft("");
    setError(null);
    setIsLoading(false);
    setIsLoadingOlder(false);
    setHasMoreMessages(false);
    pendingScrollRef.current = null;
    prependScrollRef.current = null;
    isLoadingOlderRef.current = false;
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
    <main className="harold-page min-h-screen">
      <div className="harold-phone mx-auto flex h-[100dvh] max-w-[430px] flex-col overflow-hidden">
        <div className="harold-status-bar relative h-5 px-2 text-[11px] font-bold leading-none">
          <span className="harold-status-text absolute left-2 top-1/2 flex -translate-y-1/2 items-end gap-[2px]">
            <i className="fa-solid fa-signal text-[11px]" aria-hidden="true" />
          </span>
          <span className="harold-status-text absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            {currentTime}
          </span>
          <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            <span className="harold-battery-body h-[10px] w-[22px] rounded-[3px]" />
            <span className="harold-battery-cap -ml-px h-[5px] w-[2px] rounded-r-sm" />
          </span>
        </div>

        <header className="harold-nav-bar relative flex h-[46px] items-center justify-center px-3 text-white">
          <button
            type="button"
            onClick={handleNewChat}
            disabled={!isReady}
            className="harold-nav-button absolute left-2 rounded-md px-3 py-1.5 text-[13px] font-bold transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            New Chat
          </button>
          <div className="harold-title-shadow text-center">
            <h1 className="text-[21px] font-bold leading-none tracking-tight">
              Harold
            </h1>
          </div>
        </header>

        <section
          ref={scrollContainerRef}
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
      </div>
    </main>
  );
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
