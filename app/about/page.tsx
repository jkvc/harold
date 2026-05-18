"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HaroldShell } from "@/app/components/harold-shell";

export default function AboutPage() {
  const router = useRouter();
  const [isLeaving, setIsLeaving] = useState(false);

  function handleBack() {
    setIsLeaving(true);
    window.setTimeout(() => router.push("/"), 180);
  }

  return (
    <HaroldShell
      title="About"
      leading={
        <button
          type="button"
          onClick={handleBack}
          className="harold-nav-button rounded-md px-3 py-1.5 text-[13px] font-bold leading-none transition hover:brightness-105"
        >
          ‹ Back
        </button>
      }
    >
      <section
        className={`harold-app-screen harold-about-surface scrollbar-none flex-1 overflow-y-auto px-4 py-5 ${
          isLeaving ? "harold-app-screen-exit" : ""
        }`}
      >
        <div className="space-y-4">
          <article className="harold-about-card rounded-2xl p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              What is Harold?
            </h2>
            <p className="mt-2 text-[15px] font-medium leading-6 text-slate-700">
              Harold is a small educational demo about what it might feel like
              to text with an AI that is not locked into strict turns. The chat
              is designed to feel casual: you send messages whenever you want,
              and Harold will eventually wake up, read what changed, and reply
              in short bursts.
            </p>
          </article>

          <article className="harold-about-card rounded-2xl p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              What works now
            </h2>
            <p className="mt-2 text-[15px] font-medium leading-6 text-slate-700">
              Phase 1 is the chat shell. Your browser gets an anonymous visitor
              ID, messages are saved to Postgres, and the UI can reload or page
              through the same thread. Refresh Chat starts a new visitor ID
              without deleting the old database rows.
            </p>
          </article>

          <article className="harold-about-card rounded-2xl p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              What comes next
            </h2>
            <p className="mt-2 text-[15px] font-medium leading-6 text-slate-700">
              The next phase adds the agent loop: a wake signal tells Harold to
              check the database, an LLM run decides what to do, and server-sent
              events stream Harold&apos;s messages back into the chat. The wake
              signal itself carries no message content; the database remains the
              source of truth.
            </p>
          </article>

          <article className="harold-about-card rounded-2xl p-4">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Why this shape?
            </h2>
            <p className="mt-2 text-[15px] font-medium leading-6 text-slate-700">
              Harold is a simplified extraction of a larger multi-agent system:
              one visitor, one conversation, one agent. The demo keeps the
              durable chat, visitor identity, wake model, and future memory
              system, but leaves out the multi-agent coordination so the core
              pattern is easier to see.
            </p>
          </article>
        </div>
      </section>
    </HaroldShell>
  );
}

