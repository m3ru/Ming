"use client"

import React from "react";

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
  const blocks: { transcript: React.ReactNode; comment?: React.ReactNode; index?: number }[] = [];
    let commentCounter = 1;

    text.split("\n\n").forEach((block) => {
      let remaining = block.trim();
      let elements: React.ReactNode[] = [];
  const commentTexts: { idx: number; text: string }[] = [];
      let highlightIndex: number | undefined;

      // Process either <highlight> or <comment ...> tags in order of appearance
      while (true) {
        const nextHighlight = remaining.indexOf("<highlight>");
        const nextCommentTag = remaining.indexOf("<comment");

        // if neither tag present, break
        if (nextHighlight === -1 && nextCommentTag === -1) break;

        // determine which tag comes first
        const useComment = nextCommentTag !== -1 && (nextCommentTag < nextHighlight || nextHighlight === -1);

        if (useComment) {
          // extract pre, the opening tag, attributes, inner text, and rest
          const pre = remaining.slice(0, nextCommentTag);
          const openTagMatch = remaining.slice(nextCommentTag).match(/^<comment\s*([^>]*)>/);
          if (!openTagMatch) break; // malformed
          const attrText = openTagMatch[1];
          const afterOpen = remaining.slice(nextCommentTag + openTagMatch[0].length);
          const closeIdx = afterOpen.indexOf("</comment>");
          if (closeIdx === -1) break; // malformed
          const inner = afterOpen.slice(0, closeIdx);
          const after = afterOpen.slice(closeIdx + "</comment>".length);

          if (pre) elements.push(parseInlineMarkdown(pre));

          // parse attributes: color and feedback
          const attrs: Record<string, string> = {};
          const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
          let am: RegExpExecArray | null;
          while ((am = attrRegex.exec(attrText)) !== null) {
            attrs[am[1]] = am[2];
          }

          const color = attrs.color || "yellow";
          const feedback = attrs.feedback || "";

          // determine background style class for common colors, otherwise inline style
          const colorMap: Record<string, string> = {
            yellow: "bg-yellow-200",
            red: "bg-red-200",
            green: "bg-green-200",
            blue: "bg-blue-200",
            teal: "bg-teal-200",
            gray: "bg-gray-200",
          };

          const bgClass = colorMap[color.toLowerCase()];

          // push highlighted inner text
          let marker: number | null = null;
          if (feedback) {
            marker = commentCounter++;
            commentTexts.push({ idx: marker, text: feedback });
          }

          elements.push(
            <span key={blocks.length + elements.length} className={`${bgClass ?? "bg-yellow-200"} px-1 rounded`} style={bgClass ? undefined : { backgroundColor: color }}>
              {parseInlineMarkdown(inner)}
              {marker && <sup className="text-[10px] text-gray-600 ml-0.5 align-baseline -translate-y-1">{marker}</sup>}
            </span>
          );
          remaining = after;
        } else {
          // handle <highlight>
          const pre = remaining.slice(0, nextHighlight);
          const afterOpen = remaining.slice(nextHighlight + "<highlight>".length);
          const closeIdx = afterOpen.indexOf("</highlight>");
          if (closeIdx === -1) break; // malformed
          const inner = afterOpen.slice(0, closeIdx);
          let after = afterOpen.slice(closeIdx + "</highlight>".length);


          // check for following <comment>...</comment> immediately after highlight
          let feedback: string | null = null;
          if (after.startsWith("<comment>") && after.includes("</comment>")) {
            feedback = after.split("<comment>")[1].split("</comment>")[0];
            after = after.split("</comment>")[1];
          }

          if (pre) elements.push(parseInlineMarkdown(pre));

          let marker: number | null = null;
          if (feedback) {
            marker = commentCounter++;
            commentTexts.push({ idx: marker, text: feedback });
          }

          elements.push(
            <span key={blocks.length + elements.length} className="bg-yellow-200 px-1 rounded">
              {parseInlineMarkdown(inner)}
              {marker && <sup className="text-[10px] text-gray-600 ml-0.5 align-baseline -translate-y-1">{marker}</sup>}
            </span>
          );
          remaining = after;
        }
      }

      if (remaining) elements.push(parseInlineMarkdown(remaining));

      const commentNode = commentTexts.length > 0 ? (
        <div className="space-y-2">
          {commentTexts.map((c) => (
            <div key={c.idx} className="flex bg-yellow-100 border border-gray-100 rounded-sm p-1 shadow-sm">
              <div className="m-1 mr-0 text-sm text-blue-700 break-words">{c.text}</div>
              <span className="flex mr-1 mt-4 flex-col p-0 h-auto">
                <sup className="text-[10px] text-gray-600 ml-0.25 align-baseline -translate-y-1">{c.idx}</sup>
              </span>
            </div>
          ))}
        </div>
      ) : undefined;

      blocks.push({ transcript: <p className="break-words m-0">{elements}</p>, comment: commentNode });
    });

    return blocks;
  };




export default function AnnotatedTranscript({ segments }: { segments?: { title: string; content: string }[] }) {
  const [md, setMd] = React.useState("");

  // If segments prop provided, build markdown from segments (title + content)
  React.useEffect(() => {
    if (segments && segments.length > 0) {
      const built = segments
        .map((s) => `*${s.title}*\n\n${s.content}`)
        .join("\n\n");
      setMd(built);
      return;
    }

    // Fallback: load sample markdown once
    let mounted = true;
    fetch("/sample.md")
      .then((res) => res.text())
      .then((text) => mounted && setMd(text))
      .catch(() => mounted && setMd("Error: Could not load markdown file."));
    return () => {
      mounted = false;
    };
  }, [segments]);

  const blocks = React.useMemo(() => renderMarkdownBlocks(md), [md]);

  return (
    <div className="bg-white p-0 pl-5 rounded-md overflow-auto">
      <div>
        {blocks.map((block, i) => (
          <div key={i} className="flex items-start py-1 gap-2 leading-snug">
            <div className="flex-1 py-0 mr-3 whitespace-pre-wrap">
              {/* Render transcript; for segment titles we added bold markup earlier */}
              {block.transcript}
            </div>

            <div className="w-45 py-1">
              {block.comment && (
                <div className="bg-gray-50 border-l-4 border-blue-300 rounded px-2 py-1 text-gray-800 break-words">
                  {block.comment}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}