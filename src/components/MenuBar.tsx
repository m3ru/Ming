"use client";
import React from "react";

export default function MenuBar() {

  return (
    <nav className="bg-gray-400 text-white shadow-md w-full h-14">
      <div className="flex w-full mx-auto px-4 h-full justify-between items-center">
          {/* Logo / Home button */}
          <div className="flex-shrink-0 flex-1/6">
            <button
              onClick={() => null}
              className="text-lg font-bold hover:text-gray-200 px-3 py-1 rounded"
            >
              Home
            </button>
          </div>

          {/* Future menu items can go here */}
          <div className="hidden md:flex space-x-4 flex-2/3 items-center justify-center text-2xl font-bold">Ming</div>
          <div className="hidden md:flex space-x-4 flex-1/6"></div>
      </div>
    </nav>
  );
}