"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { useSessionActions } from "@/components/SessionActionsProvider";

// Plain anchors on purpose: a full document load gives the next page a fresh Cedar session.
const links = [
  { href: "/", label: "Practice" },
  { href: "/report", label: "Reports" },
];

export default function MenuBar() {
  const { startNewSession, isStarting, error } = useSessionActions();
  const pathname = usePathname() ?? "/";
  const current = pathname.startsWith("/report") ? "/report" : "/";
  return (
    <nav aria-label="Main navigation" className="relative h-14 w-full border-b border-rule bg-paper px-4 lg:px-8">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-2 sm:gap-6">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation on purpose */}
        <a
          href="/"
          aria-label="Ming home"
          className="relative isolate text-2xl font-black tracking-tight text-ink"
        >
          Ming
          <span aria-hidden className="absolute inset-x-[-0.1em] bottom-[0.05em] -z-10 h-[0.3em] -rotate-1 rounded-full bg-highlight" />
        </a>

        <div className="flex h-full items-stretch gap-1 sm:gap-2">
          {links.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              aria-current={current === href ? "page" : undefined}
              className={`flex items-center border-b-2 px-2 text-sm font-semibold sm:px-3 ${
                current === href
                  ? "border-pencil text-ink"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => { void startNewSession().catch(() => {}); }}
            disabled={isStarting}
            aria-busy={isStarting}
            aria-describedby={error ? "new-session-error" : undefined}
            className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-pencil px-3 py-1.5 text-sm font-semibold text-white hover:bg-pencil/90 disabled:cursor-wait disabled:opacity-60 sm:px-4"
          >
            {isStarting ? "Starting…" : "New session"}
          </button>
          <div className="pointer-events-none hidden h-8 w-8 items-center justify-center rounded-full bg-highlight text-sm font-bold text-ink sm:flex">
            M
          </div>
        </div>
      </div>
      {error && (
        <div id="new-session-error" role="alert" className="absolute right-3 top-full z-50 mt-2 max-w-sm rounded-lg border border-red-pencil/40 bg-white px-4 py-3 text-sm text-red-pencil shadow-md sm:right-4">
          {error}
        </div>
      )}
    </nav>
  );
}
