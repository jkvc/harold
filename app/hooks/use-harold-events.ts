"use client";

import { useEffect, useRef } from "react";
import type { HaroldSseEvent } from "@/app/lib/harold/types";

type UseHaroldEventsParams = {
  enabled: boolean;
  onEvent: (event: HaroldSseEvent) => void;
};

export function useHaroldEvents({ enabled, onEvent }: UseHaroldEventsParams) {
  const cursorRef = useRef(0);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimeout: number | null = null;
    let isClosed = false;

    function connect() {
      const params = new URLSearchParams();
      if (cursorRef.current > 0) {
        params.set("cursor", String(cursorRef.current));
      }

      source = new EventSource(
        `/api/events${params.size > 0 ? `?${params.toString()}` : ""}`,
        { withCredentials: true },
      );

      source.onmessage = (message) => {
        const event = JSON.parse(message.data) as HaroldSseEvent;
        cursorRef.current = Math.max(cursorRef.current, event.eventId);
        onEventRef.current(event);
      };

      source.onerror = () => {
        source?.close();
        source = null;

        if (isClosed || reconnectTimeout) {
          return;
        }

        reconnectTimeout = window.setTimeout(() => {
          reconnectTimeout = null;
          connect();
        }, 1000);
      };
    }

    connect();

    return () => {
      isClosed = true;
      if (reconnectTimeout) {
        window.clearTimeout(reconnectTimeout);
      }
      source?.close();
    };
  }, [enabled]);
}
