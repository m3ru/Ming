"use client";
import React from "react";

export default function MenuBar() {
  return (
    <nav className="w-full bg-white border-b border-gray-100 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6">
        <div className="h-12 flex items-center justify-between">
          {/* Left: Home / logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => (window.location.href = "/")}
              className="inline-flex items-center gap-2 text-gray-800 hover:bg-gray-100 rounded-md px-2 py-1 text-sm font-semibold"
              aria-label="Home"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path d="M10 2L2 8v8a1 1 0 001 1h5v-5h4v5h5a1 1 0 001-1V8l-8-6z" />
              </svg>
              <span className="hidden sm:inline">Home</span>
            </button>
          </div>

          {/* Center: Title */}
          <div className="flex-1 flex items-center justify-center">
            <div className="text-2xl font-bold text-gray-900 tracking-tight">Ming</div>
          </div>

          {/* Right: small actions / avatar */}
          <div className="flex items-center gap-3">
            <a href="/report" className="hidden sm:inline text-sm text-gray-600 hover:text-gray-800 px-2 py-1 rounded">Reports</a>
            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-medium">M</div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}