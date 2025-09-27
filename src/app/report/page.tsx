'use client';
import { useState, useEffect } from "react";

export default function ReportPage() {
  const [md, setMd] = useState<string>("Loading...");
  const [summary, setSummary] = useState<string>("Loading AI Summary...");
  const [feedback, setFeedback] = useState<string>("Loading AI Feedback...");
  const [scoring, setScores] = useState<string>("Loading AI Scoring...");

  // Load markdown file
  useEffect(() => {
    fetch("/sample.md")
      .then((res) => res.text())
      .then((text) => setMd(text))
      .catch(() => setMd("Error: Could not load markdown file."));

    // Load analyzer response from localStorage
    const stored = localStorage.getItem("reportData");
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.summary) setSummary(data.summary);
        if (data.feedback) setFeedback(data.feedback);
        if (data.scoring) setScores(data.scoring);
      } catch {}
    }
  }, []);

  const parseInlineMarkdown = (text: string) => {
    const elements: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|\*.*?\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(text.slice(lastIndex, match.index));
      }

      const part = match[0];
      if (part.startsWith("**") && part.endsWith("**")) {
        elements.push(
          <strong key={lastIndex} className="font-bold">{part.slice(2, -2)}</strong>
        );
      } else if (part.startsWith("*") && part.endsWith("*")) {
        elements.push(
          <em key={lastIndex} className="italic">{part.slice(1, -1)}</em>
        );
      }

      lastIndex = match.index + part.length;
    }

    if (lastIndex < text.length) {
      elements.push(text.slice(lastIndex));
    }

    return elements;
  };

  const renderMarkdownBlocks = (text: string) => {
    const blocks: { transcript: React.ReactNode; comment?: string; index?: number }[] = [];
    let commentCounter = 1; // global counter for numbering

    text.split("\n\n").forEach((block) => {
      let remaining = block.trim();
      let elements: React.ReactNode[] = [];
      let commentText: string | undefined = undefined;
      let highlightIndex: number | undefined;

      while (remaining.includes("<highlight>") && remaining.includes("</highlight>")) {
        const pre = remaining.split("<highlight>")[0];
        const highlightPart = remaining.split("<highlight>")[1].split("</highlight>")[0];
        const afterHighlight = remaining.split("</highlight>")[1];

        // Check for comment
        if (afterHighlight.includes("<comment>") && afterHighlight.includes("</comment>")) {
          commentText = afterHighlight.split("<comment>")[1].split("</comment>")[0];
          highlightIndex = commentCounter++; // assign number and increment
          remaining = afterHighlight.split("</comment>")[1];
        } else {
          remaining = afterHighlight;
        }

        if (pre) elements.push(parseInlineMarkdown(pre));

        elements.push(
          <span
            key={blocks.length + elements.length}
            className="bg-yellow-200 px-1 rounded"
          >
            {parseInlineMarkdown(highlightPart)}
            {highlightIndex && (
              <sup className="text-xs text-gray-600 ml-0.5">{highlightIndex}</sup>
            )}
          </span>
        );
      }

      if (remaining) elements.push(parseInlineMarkdown(remaining));

      blocks.push({
        transcript: <p className="break-words m-0">{elements}</p>,
        comment: commentText,
        index: highlightIndex
      });
    });

    return blocks;
  };

  const blocks = renderMarkdownBlocks(md);

  return (
    <div className="min-h-screen flex justify-center font-sans bg-gray-50 p-6">
      {/* Main container */}
      <div className="flex flex-col w-full max-w-3xl space-y-8">
        {/* Summary */}
        <div  className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl p-0 m-0 font-bold text-center">Conversation Summary</h2>
          <div>
            {summary}
          </div>
        </div>

        {/* Feedback */}
        <div  className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl p-0 m-0 font-bold text-center">Feedback</h2>
          <div>
            {feedback}
          </div>
        </div>

        {/* Scoring */}
        <div  className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl p-0 m-0 font-bold text-center">Scoring</h2>
          <div>
            {scoring}
          </div>
        </div>

        {/* Transcript with comments */}
        <div  className="bg-white p-4 rounded-lg shadow-md max-h-[500px] overflow-auto">
          <h2 className="text-2xl p-2 m-0 font-bold text-center">Annotated Transcript</h2>
          <div>
            {blocks.map((block, i) => (
              <div key={i} className="flex items-start">
                {/* Transcript column */}
                <div className="flex-1 py-1 mr-4 whitespace-pre-wrap">
                  {block.transcript}
                </div>

                {/* Comments column */}
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