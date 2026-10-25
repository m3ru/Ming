"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

export function ReportMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline [&_a]:underline-offset-4 [&_pre]:overflow-auto">
      <ReactMarkdown
        skipHtml
        allowedElements={[
          "p",
          "br",
          "strong",
          "em",
          "ul",
          "ol",
          "li",
          "blockquote",
          "code",
          "pre",
          "a",
          "h3",
          "h4",
        ]}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Restrict model-provided highlight colours to these highlighter tints; valence
// colours the matching margin note.
const highlighters: Record<string, { stroke: string; note: string }> = {
  yellow: { stroke: "", note: "text-pencil" },
  green: { stroke: "bg-sage/25", note: "text-sage" },
  red: { stroke: "bg-red-pencil/15", note: "text-red-pencil" },
  blue: { stroke: "bg-pencil/15", note: "text-pencil" },
  teal: { stroke: "bg-sage/15", note: "text-pencil" },
  gray: { stroke: "bg-rule/60", note: "text-pencil" },
};

const circled =
  "inline-flex size-[1.4em] shrink-0 items-center justify-center rounded-full border border-current font-sans font-semibold leading-none";

const parseInlineMarkdown = (text: string) => {
  const elements: React.ReactNode[] = [];
  const regex = /(\*\*.*?\*\*|\*.*?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex)
      elements.push(text.slice(lastIndex, match.index));

    const part = match[0];
    if (part.startsWith("**") && part.endsWith("**")) {
      const bold = part.slice(2, -2);
      // Display only: the parser labels the learner "User:".
      elements.push(
        <strong key={lastIndex}>{bold === "User:" ? "You:" : bold}</strong>,
      );
    } else if (part.startsWith("*") && part.endsWith("*")) {
      elements.push(<em key={lastIndex}>{part.slice(1, -1)}</em>);
    }

    lastIndex = match.index + part.length;
  }

  if (lastIndex < text.length) elements.push(text.slice(lastIndex));
  return elements;
};

const renderMarkdownBlocks = (text: string) => {
  const blocks: {
    transcript: React.ReactNode;
    comment?: React.ReactNode;
    index?: number;
  }[] = [];
  let commentCounter = 1;

  text.split("\n\n").forEach((block) => {
    let remaining = block.trim();
    const elements: React.ReactNode[] = [];
    const commentTexts: { idx: number; text: string; note: string }[] = [];

    // Process either <highlight> or <comment ...> tags in order of appearance
    while (true) {
      const nextHighlight = remaining.indexOf("<highlight>");
      const nextCommentTag = remaining.indexOf("<comment");

      // if neither tag present, break
      if (nextHighlight === -1 && nextCommentTag === -1) break;

      // determine which tag comes first
      const useComment =
        nextCommentTag !== -1 &&
        (nextCommentTag < nextHighlight || nextHighlight === -1);

      if (useComment) {
        // extract pre, the opening tag, attributes, inner text, and rest
        const pre = remaining.slice(0, nextCommentTag);
        const openTagMatch = remaining
          .slice(nextCommentTag)
          .match(/^<comment\s*([^>]*)>/);
        if (!openTagMatch) break; // malformed
        const attrText = openTagMatch[1];
        const afterOpen = remaining.slice(
          nextCommentTag + openTagMatch[0].length,
        );
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

        const tint = highlighters[color.toLowerCase()] ?? highlighters.yellow;

        // push highlighted inner text
        let marker: number | null = null;
        if (feedback) {
          marker = commentCounter++;
          commentTexts.push({ idx: marker, text: feedback, note: tint.note });
        }

        elements.push(
          <span
            key={blocks.length + elements.length}
            className={`marker ${tint.stroke}`}
          >
            {parseInlineMarkdown(inner)}
            {marker && (
              <sup className={`${circled} ml-1 text-[10px] text-ink-soft`}>
                {marker}
              </sup>
            )}
          </span>,
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
          commentTexts.push({
            idx: marker,
            text: feedback,
            note: highlighters.yellow.note,
          });
        }

        elements.push(
          <span key={blocks.length + elements.length} className="marker">
            {parseInlineMarkdown(inner)}
            {marker && (
              <sup className={`${circled} ml-1 text-[10px] text-ink-soft`}>
                {marker}
              </sup>
            )}
          </span>,
        );
        remaining = after;
      }
    }

    if (remaining) elements.push(parseInlineMarkdown(remaining));

    const commentNode =
      commentTexts.length > 0 ? (
        <ol className="space-y-3">
          {commentTexts.map((c) => (
            <li key={c.idx} className={`flex items-start gap-2 ${c.note}`}>
              <span className={`${circled} mt-0.5 text-xs`}>{c.idx}</span>
              <span className="hand break-words text-[26px]">{c.text}</span>
            </li>
          ))}
        </ol>
      ) : undefined;

    blocks.push({
      transcript: <p className="break-words m-0">{elements}</p>,
      comment: commentNode,
    });
  });

  return blocks;
};

export default function AnnotatedTranscript({
  segments,
}: {
  segments?: { title: string; content: string }[];
}) {
  const md = (segments || []).map((segment) => segment.content).join("\n\n");
  const blocks = React.useMemo(() => renderMarkdownBlocks(md), [md]);

  if (!md.trim()) {
    return (
      <p className="py-2 text-ink-soft">
        No annotated transcript is available for this report.
      </p>
    );
  }

  return (
    <div className="divide-y divide-dashed divide-rule">
      {blocks.map((block, i) => (
        <div
          key={i}
          className="grid gap-x-8 gap-y-2 py-3 leading-relaxed md:grid-cols-[minmax(0,1fr)_15rem]"
        >
          <div className="min-w-0 whitespace-pre-wrap">{block.transcript}</div>
          {block.comment ? (
            <div className="min-w-0">{block.comment}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
