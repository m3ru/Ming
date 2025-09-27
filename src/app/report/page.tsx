'use client';
import { useState, useEffect, useRef } from "react";

export default function reportPage() {
  const [md, setMd] = useState<string>("Loading...");
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [commentTop, setCommentTop] = useState<number>(0);

  const [summary, setSummary] = useState<string>("Loading AI Summary...");
  const [feedback, setFeedback] = useState<string>("Loading AI Feedback...");
  const [scoring, setScores] = useState<string>("Loading AI Scoring...");


  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/sample.md")
      .then((res) => res.text())
      .then((text) => setMd(text))
      .catch(() => setMd("Error: Could not load markdown file."));
  }, []);

  // Hide comment when clicking outside highlight
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("highlighted-text")) {
        setActiveComment(null);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
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

  const renderMarkdown = (text: string) => {
    return text.split("\n\n").map((block, i) => {
      block = block.trim();
      const elements: React.ReactNode[] = [];
      let remaining = block;

      while (remaining.includes("<highlight>") && remaining.includes("</highlight>")) {
        const pre = remaining.split("<highlight>")[0];
        const highlightPart = remaining.split("<highlight>")[1].split("</highlight>")[0];
        const afterHighlight = remaining.split("</highlight>")[1];

        // Check for comment
        let commentText: string | null = null;
        if (afterHighlight.includes("<comment>") && afterHighlight.includes("</comment>")) {
          commentText = afterHighlight.split("<comment>")[1].split("</comment>")[0];
          remaining = afterHighlight.split("</comment>")[1];
        } else {
          remaining = afterHighlight;
        }

        if (pre) elements.push(parseInlineMarkdown(pre));

        elements.push(
          <span
            key={i + elements.length}
            className="highlighted-text bg-yellow-200 cursor-pointer px-1 rounded"
            onClick={(e) => {
              e.stopPropagation();
              if (transcriptRef.current) {
                const rect = (e.target as HTMLSpanElement).getBoundingClientRect();
                const parentRect = transcriptRef.current.getBoundingClientRect();
                setCommentTop(rect.top - parentRect.top);
                setActiveComment(commentText);
              }
            }}
          >
            {parseInlineMarkdown(highlightPart)}
          </span>
        );
      }

      if (remaining) elements.push(parseInlineMarkdown(remaining));

      return (
        <p key={i} className="mb-4 text-gray-800 break-words whitespace-pre-wrap">
          {elements}
        </p>
      );
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center font-sans space-y-8 p-6 bg-gray-50">
        <div>
            <h2 className="text-2xl p-2 m-0 font-bold text-center">Conversation Summary</h2>
            <div className="flex-1 bg-white p-6 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
                {summary}
            </div>
        </div>
        <div>
            <h2 className="text-2xl p-2 m-0 font-bold text-center">Feedback</h2>
            <div className="flex-1 bg-white p-6 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
                {feedback}
            </div>
        </div>
        <div>
            <h2 className="text-2xl p-2 m-0 font-bold text-center">Scoring</h2>
            <div className="flex-1 bg-white p-6 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
                {scoring}
            </div>
        </div>
    <div>
      <h2 className="text-2xl p-2 m-0 font-bold text-center">Annotated Transcript</h2>

      <div className="flex w-full max-w-3xl relative gap-4">
        {/* Transcript box */}
        <div
          ref={transcriptRef}
          className="flex-1 bg-white p-6 rounded-lg shadow-md max-h-[500px] overflow-auto break-words"
        >
          {renderMarkdown(md)}
        </div>

        {/* Comment box */}
        {activeComment && (
          <div
            className="w-80 bg-gray-100 border border-gray-300 rounded p-3 shadow break-words"
            style={{ position: "absolute", left: "calc(100% + 16px)", top: commentTop }}
          >
            {activeComment}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}