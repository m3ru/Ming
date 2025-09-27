"use client";
import React from "react";
import { useRouter } from "next/router"; // if using Next.js for routing

export default function MenuBar() {

  return (
    <nav className="bg-gray-400 text-white shadow-md w-full place-items-start">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Home button */}
          <div className="flex-shrink-0">
            <button
              onClick={() =>  null}
              className="text-lg font-bold hover:text-gray-200"
            >
              Home
            </button>
          </div>

          {/* Future menu items can go here */}
          <div className="hidden md:flex space-x-4"></div>
        </div>
      </div>
    </nav>
  );
}