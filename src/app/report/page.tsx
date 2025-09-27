 'use client';
import React, { useState, useEffect } from "react";
import ScoreBar from "@/components/ScoreBar";

const defaultScores = [
  { category: "Empathy", score: 85 },
  { category: "Clarity", score: 90 },
  { category: "Open-mindedness", score: 80 },
  { category: "Assertiveness", score: 75 },
  { category: "Active Listening", score: 88 },
  { category: "Conflict Management", score: 82 },
];

export default function ReportPage() {
  const [md, setMd] = useState<string>("Loading...");
  const [summary, setSummary] = useState<string>("Loading AI Summary...");
  const [feedback, setFeedback] = useState<string>("Loading AI Feedback...");
  const [scoring, setScores] = useState<typeof defaultScores>(defaultScores);

  // Load markdown and localStorage data
  useEffect(() => {
    // Load transcript markdown
    fetch("/sample.md")
      .then(res => res.text())
      .then(text => setMd(text))
      .catch(() => setMd("Error: Could not load markdown file."));

    // Load analyzer response from localStorage
    const stored = localStorage.getItem("reportData");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.summary) setSummary(data.summary);
        if (data.feedback) setFeedback(data.feedback);
        if (data.scoring) setScores(data.scoring);
      } catch (err) {
        console.error("Failed to parse reportData from localStorage", err);
      }
    }
  }, []);

  const parseInlineMarkdown = (text: string) => {
    const elements: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|\*.*?\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) elements.push(text.slice(lastIndex, match.index));

      const part = match[0];
      if (part.startsWith("**") && part.endsWith("**")) {
        elements.push(<strong key={lastIndex}>{part.slice(2, -2)}</strong>);
      } else if (part.startsWith("*") && part.endsWith("*")) {
        elements.push(<em key={lastIndex}>{part.slice(1, -1)}</em>);
      }

      lastIndex = match.index + part.length;
    }

    if (lastIndex < text.length) elements.push(text.slice(lastIndex));
    return elements;
  };

  const renderMarkdownBlocks = (text: string) => {
    const blocks: { transcript: React.ReactNode; comment?: string; index?: number }[] = [];
    let commentCounter = 1;

    text.split("\n\n").forEach((block) => {
      let remaining = block.trim();
      let elements: React.ReactNode[] = [];
      let commentText: string | undefined = undefined;
      let highlightIndex: number | undefined;

      while (remaining.includes("<highlight>") && remaining.includes("</highlight>")) {
        const pre = remaining.split("<highlight>")[0];
        const highlightPart = remaining.split("<highlight>")[1].split("</highlight>")[0];
        const afterHighlight = remaining.split("</highlight>")[1];

        if (afterHighlight.includes("<comment>") && afterHighlight.includes("</comment>")) {
          commentText = afterHighlight.split("<comment>")[1].split("</comment>")[0];
          highlightIndex = commentCounter++;
          remaining = afterHighlight.split("</comment>")[1];
        } else {
          remaining = afterHighlight;
        }

        if (pre) elements.push(parseInlineMarkdown(pre));

        elements.push(
          <span key={blocks.length + elements.length} className="bg-yellow-200 px-1 rounded">
            {parseInlineMarkdown(highlightPart)}
            {highlightIndex && <sup className="text-xs text-gray-600 ml-0.5">{highlightIndex}</sup>}
          </span>
        );
      }

      if (remaining) elements.push(parseInlineMarkdown(remaining));

      blocks.push({ transcript: <p className="break-words m-0">{elements}</p>, comment: commentText, index: highlightIndex });
    });

    return blocks;
  };

  const blocks = renderMarkdownBlocks(md);

  return (
    <div className="min-h-screen flex justify-center font-sans bg-gray-50 p-6">
      <div className="flex flex-col w-full max-w-3xl space-y-8">
        {/* Summary */}
        <div className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl font-bold text-center">Conversation Summary</h2>
          <div>{summary}</div>
        </div>

        {/* Feedback */}
        <div className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl font-bold text-center">Feedback</h2>
          <div>{feedback}</div>
        </div>

        {/* Scoring */}
        <div className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl font-bold text-center">Scoring</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <ScoreBar category={scoring[0].category} score={scoring[0].score} />
              <ScoreBar category={scoring[2].category} score={scoring[2].score} />
              <ScoreBar category={scoring[4].category} score={scoring[4].score} />
            </div>
            <div className="flex-1">
              <ScoreBar category={scoring[1].category} score={scoring[1].score} />
              <ScoreBar category={scoring[3].category} score={scoring[3].score} />
              <ScoreBar category={scoring[5].category} score={scoring[5].score} />
            </div>
          </div>
        </div>

        {/* Transcript */}
        <div className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto">
          <h2 className="text-2xl font-bold text-center">Annotated Transcript</h2>
          <div>
            {blocks.map((block, i) => (
              <div key={i} className="flex items-start">
                <div className="flex-1 py-1 mr-4 whitespace-pre-wrap">{block.transcript}</div>
                <div className="w-56 py-1">
                  {block.comment && (
                    <div className="bg-gray-100 rounded px-2 py-1 text-sm text-gray-800 break-words">
                      <sup className="text-xs text-gray-600 mr-1">{block.index}</sup>
                      {block.comment}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}