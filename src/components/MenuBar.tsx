"use client";
import React from "react";
import { useSessionActions } from "@/components/SessionActionsProvider";

export default function MenuBar() {
  const { startNewSession, isStarting, error } = useSessionActions();
  return (
    <nav aria-label="Main navigation" className="relative w-full bg-white border-b border-gray-100 px-3 sm:px-4 lg:px-6">
      <div className="h-12 flex items-center justify-between">
        {/* Left: Home */}
        <button
          onClick={() => (window.location.href = "/")}
          className="inline-flex items-center gap-2 text-gray-800 hover:bg-gray-100 rounded-md px-2 py-1 text-sm font-semibold cursor-pointer"
          aria-label="Home"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5 text-blue-600"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M10 2L2 8v8a1 1 0 001 1h5v-5h4v5h5a1 1 0 001-1V8l-8-6z" />
          </svg>
          <span className="hidden sm:inline">Home</span>
        </button>

        {/* Center: Title */}
        <div className="text-center text-2xl font-bold text-gray-900 tracking-tight">
          Ming
        </div>

        {/* Right: Reports / Avatar */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => { void startNewSession().catch(() => {}); }}
            disabled={isStarting}
            aria-busy={isStarting}
            aria-describedby={error ? "new-session-error" : undefined}
            className="inline-flex min-h-9 items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
          >
            {isStarting ? "Starting…" : "New Session"}
          </button>
          <a
            href="/report"
            className="hidden sm:inline text-sm text-gray-600 hover:text-gray-800 px-2 py-1 rounded"
          >
            Reports
          </a>
          <div className="pointer-events-none h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">
            M
          </div>
        </div>
      </div>
      {error && (
        <div id="new-session-error" role="alert" className="absolute right-3 top-full z-50 mt-2 max-w-sm rounded-lg border border-red-200 bg-white px-4 py-3 text-sm text-red-800 shadow-md sm:right-4">
          {error}
        </div>
      )}
    </nav>
  );
}
