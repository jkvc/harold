"use client";

import { UIEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  DebugEventDto,
  DebugEventPageDto,
} from "@/app/lib/harold/types";
import type { ApiResponse } from "@/app/lib/api-types";

type DebugTimelineProps = {
  isOpen: boolean;
  events: DebugEventDto[];
  hasMore: boolean;
  isAwake: boolean;
  onClose: () => void;
  onLoadInitial: (page: DebugEventPageDto) => void;
  onLoadOlder: (page: DebugEventPageDto) => void;
};

type WakePreview = {
  messages: Array<{
    id: string;
    content: string;
    replyToId: string | null;
    createdAt: string;
  }>;
  status: "sleeping" | "working";
  activeRunId: string | null;
};

export function DebugTimeline({
  isOpen,
  events,
  hasMore,
  isAwake,
  onClose,
  onLoadInitial,
  onLoadOlder,
}: DebugTimelineProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isWaking, setIsWaking] = useState(false);
  const [wakePreview, setWakePreview] = useState<WakePreview | null>(null);
  const [wakePreviewError, setWakePreviewError] = useState<string | null>(null);
  const [isWakePreviewOpen, setIsWakePreviewOpen] = useState(false);
  const [isLoadingWakePreview, setIsLoadingWakePreview] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const shouldJumpToBottomRef = useRef(false);

  useEffect(() => {
    if (!isOpen || events.length > 0) {
      return;
    }

    let cancelled = false;
    fetchDebugPage()
      .then((page) => {
        if (!cancelled) {
          onLoadInitial(page);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [events.length, isOpen, onLoadInitial]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    shouldJumpToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
  }, [isOpen]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    if (shouldJumpToBottomRef.current) {
      shouldJumpToBottomRef.current = false;
      scrollElement.scrollTop = scrollElement.scrollHeight;
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }, [events.length, isOpen]);

  if (!isOpen) {
    return null;
  }

  const timelineEvents = events;

  function handleTimelineScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    shouldStickToBottomRef.current = distanceFromBottom < 48;
  }

  async function loadOlder() {
    if (events.length === 0) {
      return;
    }

    setIsLoading(true);
    try {
      const page = await fetchDebugPage(events[0].id);
      onLoadOlder(page);
    } finally {
      setIsLoading(false);
    }
  }

  async function openWakePreview() {
    if (isAwake) {
      return;
    }

    setIsWakePreviewOpen(true);
    setIsLoadingWakePreview(true);
    setWakePreviewError(null);

    try {
      const response = await fetch("/api/wake/preview", {
        credentials: "same-origin",
      });
      const payload = (await response.json()) as ApiResponse<WakePreview>;

      if (!payload.success) {
        throw new Error(payload.error);
      }

      setWakePreview(payload.data);
    } catch (error) {
      setWakePreviewError(
        error instanceof Error ? error.message : "Could not load wake preview.",
      );
    } finally {
      setIsLoadingWakePreview(false);
    }
  }

  async function wakeHarold() {
    setIsWaking(true);
    try {
      await fetch("/api/wake", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "debug-manual-wake" }),
      });
      setIsWakePreviewOpen(false);
    } finally {
      setIsWaking(false);
    }
  }

  return (
    <aside className="harold-debug-shell fixed inset-0 z-50 flex justify-center md:pointer-events-none md:left-[calc(50%+6px)] md:right-auto md:top-[var(--harold-viewport-offset-top,0px)] md:h-[var(--harold-viewport-height,100dvh)] md:w-[430px]">
      <div className="harold-phone pointer-events-auto relative flex h-full w-full max-w-[430px] flex-col overflow-hidden">
        <header className="harold-nav-bar relative z-30 flex h-[46px] items-center justify-center px-3 text-white">
          <button
            type="button"
            onClick={onClose}
            className="harold-nav-button absolute left-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-[13px] font-bold leading-none transition hover:brightness-105"
          >
            Close
          </button>
          <h2 className="harold-title-shadow text-[21px] font-bold leading-none tracking-tight">
            Debug
          </h2>
          <button
            type="button"
            onClick={openWakePreview}
            disabled={isAwake || isWaking || isLoadingWakePreview}
            className="harold-nav-button absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-[13px] font-bold leading-none transition hover:brightness-105 disabled:opacity-60"
          >
            {isAwake ? "Awake" : "Wake"}
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={handleTimelineScroll}
          className="harold-chat-surface scrollbar-none flex-1 overflow-y-auto px-3 py-3"
        >
          {hasMore ? (
            <button
              type="button"
              onClick={loadOlder}
              disabled={isLoading}
              className="harold-nav-button mb-3 w-full rounded-md px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              {isLoading ? "Loading..." : "Load Older Events"}
            </button>
          ) : null}

          {timelineEvents.length === 0 ? (
            <p className="pt-10 text-center text-sm font-semibold text-slate-500">
              {isLoading ? "Loading events..." : "No debug events yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {timelineEvents.map((event) => {
                const isExpanded = expandedIds.has(event.id);
                const eventDisplay = getEventDisplay(event);
                return (
                  <button
                    type="button"
                    key={event.id}
                    onClick={() =>
                      setExpandedIds((current) => toggleSet(current, event.id))
                    }
                    className="harold-debug-row w-full rounded-xl px-3 py-2 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-700">
                        <i
                          className={`${eventDisplay.icon} w-4 text-center text-[13px] text-[#2f83b5]`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{eventDisplay.label}</span>
                    </div>
                    {eventDisplay.summary ? (
                      <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                        {eventDisplay.summary}
                      </p>
                    ) : null}
                    {isExpanded ? (
                      <pre className="scrollbar-none mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-[11px] leading-4 text-slate-700">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isWakePreviewOpen ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/25 px-6">
            <div className="harold-alert w-full max-w-[350px] overflow-hidden rounded-2xl text-white">
              <div className="px-5 pb-4 pt-5">
                <h3 className="harold-title-shadow text-center text-[21px] font-bold leading-tight">
                  Wake Harold?
                </h3>
                <p className="mt-2 text-center text-[13px] font-semibold leading-5 text-white/90">
                  Preview of the JSON `check_inbox` will show Harold.
                </p>

                <div className="scrollbar-none mt-4 max-h-64 overflow-y-auto rounded-xl bg-white/15 p-3 text-left">
                  {isLoadingWakePreview ? (
                    <p className="text-sm font-semibold">Loading preview...</p>
                  ) : wakePreviewError ? (
                    <p className="text-sm font-semibold text-red-100">
                      {wakePreviewError}
                    </p>
                  ) : wakePreview ? (
                    <pre className="scrollbar-none max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] font-semibold leading-5 text-white">
                      {JSON.stringify(
                        { success: true, messages: wakePreview.messages },
                        null,
                        2,
                      )}
                    </pre>
                  ) : (
                    <p className="text-sm font-semibold">
                      No preview loaded yet.
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 border-t border-white/25">
                <button
                  type="button"
                  onClick={() => setIsWakePreviewOpen(false)}
                  className="harold-alert-button border-r border-white/25"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={wakeHarold}
                  disabled={
                    isAwake ||
                    isWaking ||
                    isLoadingWakePreview ||
                    Boolean(wakePreviewError)
                  }
                  className="harold-alert-button font-extrabold disabled:opacity-50"
                >
                  {isWaking ? "Waking" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

async function fetchDebugPage(before?: number): Promise<DebugEventPageDto> {
  const params = new URLSearchParams();
  if (before) {
    params.set("before", String(before));
  }

  const response = await fetch(`/api/debug?${params.toString()}`, {
    credentials: "same-origin",
  });
  const payload = (await response.json()) as ApiResponse<DebugEventPageDto>;

  if (!payload.success) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function toggleSet(values: Set<number>, id: number) {
  const next = new Set(values);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function getEventDisplay(event: DebugEventDto) {
  const eventTime = new Date(event.createdAt).toLocaleTimeString();

  if (event.payload.type === "message") {
    const sender =
      event.payload.message.role === "user" ? "User" : "Harold";
    return {
      icon: "fa-solid fa-comment",
      label: `${sender} message`,
      summary: event.payload.message.content,
    };
  }

  if (event.payload.type === "assistant_text") {
    return {
      icon: "fa-solid fa-quote-left",
      label: "Harold text",
      summary: event.payload.text,
    };
  }

  if (event.payload.type === "assistant_thinking") {
    return {
      icon: "fa-solid fa-cloud",
      label: "Harold deep thought",
      summary: event.payload.text,
    };
  }

  if (event.payload.type === "reaction") {
    return {
      icon: "fa-solid fa-face-smile",
      label: "Reaction",
      summary: `${event.payload.reaction.emoji} on ${event.payload.reaction.messageId}`,
    };
  }

  if (event.payload.type === "tool_start") {
    return {
      icon: "fa-solid fa-play",
      label: event.payload.name,
      summary: "",
    };
  }

  if (event.payload.type === "tool_complete") {
    return {
      icon: "fa-solid fa-check",
      label: event.payload.name,
      summary: summarizeToolResult(event.payload.result),
    };
  }

  if (event.payload.type === "memory_updated") {
    return {
      icon: "fa-solid fa-brain",
      label: "Memory updated",
      summary: "",
    };
  }

  if (event.payload.type === "run_start") {
    return {
      icon: "fa-solid fa-bell",
      label: "Wake",
      summary: "",
    };
  }

  if (event.payload.type === "run_end") {
    return {
      icon: "fa-solid fa-moon",
      label: event.payload.status === "completed" ? "Sleep" : "Run failed",
      summary: event.payload.error ?? "",
    };
  }

  return {
    icon: "fa-solid fa-circle",
    label: event.eventType,
    summary: eventTime,
  };
}

function summarizeToolResult(result: unknown) {
  if (!result || typeof result !== "object") {
    return "Completed";
  }

  const record = result as Record<string, unknown>;
  if (record.success === false && typeof record.error === "string") {
    return record.error;
  }

  if (Array.isArray(record.messages)) {
    return `${record.messages.length} inbox message${record.messages.length === 1 ? "" : "s"}`;
  }

  if (record.message && typeof record.message === "object") {
    return "";
  }

  if (record.reaction && typeof record.reaction === "object") {
    return "Stored reaction";
  }

  return "Completed";
}
