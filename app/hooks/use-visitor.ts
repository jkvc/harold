"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  ensureVisitorId,
  generateVisitorId,
  storeVisitorId,
} from "@/app/lib/visitor";

const VISITOR_CHANGE_EVENT = "harold:visitor-change";

export function useVisitor() {
  const visitorId = useSyncExternalStore(
    subscribeToVisitor,
    getVisitorSnapshot,
    getServerVisitorSnapshot,
  );

  const startNewChat = useCallback(() => {
    const nextVisitorId = generateVisitorId();
    storeVisitorId(nextVisitorId);
    window.dispatchEvent(new Event(VISITOR_CHANGE_EVENT));
    return nextVisitorId;
  }, []);

  return {
    isReady: visitorId !== null,
    visitorId,
    startNewChat,
  };
}

function subscribeToVisitor(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(VISITOR_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(VISITOR_CHANGE_EVENT, onStoreChange);
  };
}

function getVisitorSnapshot() {
  return ensureVisitorId();
}

function getServerVisitorSnapshot() {
  return null;
}
