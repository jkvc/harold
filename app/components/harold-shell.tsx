"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type HaroldShellProps = {
  title: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  onViewportChange?: () => void;
  isCompanionOpen?: boolean;
};

export function HaroldShell({
  title,
  leading,
  trailing,
  children,
  onViewportChange,
  isCompanionOpen = false,
}: HaroldShellProps) {
  const [currentTime, setCurrentTime] = useState("");

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
    const root = document.documentElement;
    const previousBodyOverflow = document.body.style.overflow;

    function updateViewportSize() {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;

      root.style.setProperty("--harold-viewport-height", `${viewportHeight}px`);
      root.style.setProperty(
        "--harold-viewport-offset-top",
        `${viewportOffsetTop}px`,
      );
      onViewportChange?.();
    }

    document.body.style.overflow = "hidden";
    updateViewportSize();

    window.visualViewport?.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("scroll", updateViewportSize);
    window.addEventListener("resize", updateViewportSize);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      root.style.removeProperty("--harold-viewport-height");
      root.style.removeProperty("--harold-viewport-offset-top");
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("scroll", updateViewportSize);
      window.removeEventListener("resize", updateViewportSize);
    };
  }, [onViewportChange]);

  return (
    <main className="harold-page fixed inset-x-0 top-[var(--harold-viewport-offset-top,0px)] h-[var(--harold-viewport-height,100dvh)] overflow-hidden">
      <div
        className={`harold-phone relative mx-auto flex h-full max-w-[430px] flex-col overflow-hidden transition-transform duration-200 ${
          isCompanionOpen ? "md:-translate-x-[221px]" : ""
        }`}
      >
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

        <header className="harold-nav-bar relative z-30 flex h-[46px] items-center justify-center px-3 text-white">
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            {leading}
          </div>
          <div className="harold-title-shadow text-center">
            <h1 className="text-[21px] font-bold leading-none tracking-tight">
              {title}
            </h1>
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            {trailing}
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}

