"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { CircleAlert } from "lucide-react";
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
              className={`group relative flex items-center px-2 text-sm font-semibold transition-colors sm:px-3 ${
                current === href ? "text-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              {label}
              {/* The active underline draws in on load; others preview it on hover. */}
              <span
                aria-hidden
                className={`absolute inset-x-1 bottom-0 h-0.5 rounded-full transition-[scale] duration-200 ease-out sm:inset-x-2 ${
                  current === href
                    ? "nav-underline bg-pencil"
                    : "scale-x-0 bg-ink/25 group-hover:scale-x-100"
                }`}
              />
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
        <div id="new-session-error" role="alert" className="alert-note absolute right-3 top-full z-50 mt-2 max-w-sm shadow-md sm:right-4">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-red-pencil" />
          <p className="min-w-0 flex-1">{error}</p>
          <button
            type="button"
            onClick={() => { void startNewSession().catch(() => {}); }}
            disabled={isStarting}
            className="shrink-0 cursor-pointer font-semibold text-pencil underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}
    </nav>
  );
}
