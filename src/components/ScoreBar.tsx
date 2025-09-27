"use client";
import { useState, useEffect } from "react";

export default function ScoreBar({ category, score }: { category: string; score: number }) {
  return (
  <div>
    <div className="mb-3">
        <div className="flex justify-between mb-1">
        <span className="font-medium">{category}</span>
        <span className="font-mono">{score}/100</span>
        </div>
        <div className="w-full h-4 bg-gray-200 rounded">
        <div
            className="h-4 bg-blue-500 rounded"
            style={{ width: `${score}%` }}
        ></div>
        </div>
    </div>
  </div>
  );
}