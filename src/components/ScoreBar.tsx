"use client";
import { useState, useEffect } from "react";

export default function ScoreBar({
  category,
  score,
}: {
  category: string;
  score: number;
}) {
  return (
    <div>
      <div className="mx-2 mt-2 mb-3">
        <div className="flex justify-between mb-1 max-md:text-sm">
          <span className="font-medium">{category}</span>
          <span className="font-mono">{score}/100</span>
        </div>
        <div className="max-md:hidden w-full h-3 bg-gray-200 rounded">
          <div
            className="md:h-3 bg-blue-500 rounded"
            style={{ width: `${score}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
}
