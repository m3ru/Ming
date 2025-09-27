'use client';
import { useState, useEffect, useRef } from "react";
import ScoreBar from "@/components/ScoreBar";
import {marked} from 'marked';
import MenuBar from "@/components/MenuBar";
import Parser from './parser';
import AnnotatedTranscript from "@/components/AnnotatedTranscript";
import { parseFallbackField } from "next/dist/lib/fallback";

const defaultScores = [
  { category: "Empathy", score: 85 },
  { category: "Clarity", score: 90 },
  { category: "Open-mindedness", score: 80 },
  { category: "Assertiveness", score: 75 },
  { category: "Active Listening", score: 88 },
  { category: "Conflict Management", score: 82 },
];

export default function ReportPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);

  const [md, setMd] = useState<string>("Loading...");
  const [summary, setSummary] = useState<string>("Loading AI Summary...");
  const [feedback, setFeedback] = useState<string>("Loading AI Feedback...");
  const [scoring, setScores] = useState<typeof defaultScores>(defaultScores);
  const [segments, setSegments] = useState<{ title: string; content: string }[]>([]);

  // Run Parser once on mount and populate report fields
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // fetch the public output file (output.txt) which contains the segmented transcript
        const parsed = await Parser("/output.txt");
        console.log("Parsed data from Parser():", parsed);
        if (!mounted) return;
        setSummary(parsed.summary || "No summary found.");
        setFeedback(parsed.feedback || "No feedback found.");
        setSegments(parsed.segments || []);

        //setScores(parsed.scoring || defaultScores);
        console.log("CONFIG:", parsed.config);
        console.log("SEGMENTS:", parsed.segments);
        console.log("STRENGTH:", parsed.strength);
        console.log("WEAKNESS:", parsed.weakness);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load markdown and localStorage data
  useEffect(() => {
    // Load analyzer response from localStorage
    const stored = localStorage.getItem("reportData");
    console.log("reportData from localStorage:", stored);
    if (stored != null) {
      try {
        const data = JSON.parse(stored);
        const text = data.text;
        const storedSegments = data.segments || [];

        const summaryMatch = text.match(/## CONVERSATION OVERVIEW\s*([\s\S]*?)\n## USER PERFORMANCE ANALYSIS/);
        const extractedSummary = summaryMatch ? summaryMatch[1].trim() : "";
        const analysisMatch = text.match(/## USER PERFORMANCE ANALYSIS\s*([\s\S]*)/);
        const extractedAnalysis = analysisMatch ? analysisMatch[1].trim() : "";

        if (extractedSummary) setSummary(extractedSummary);
        if (extractedAnalysis) setFeedback(extractedAnalysis);
        if (data.scoring) setScores(data.scoring);
        if (storedSegments && storedSegments.length > 0) {
          setSegments(storedSegments);
        } else if (text) {
          // try to extract <segment: ...> blocks from the returned text if segments weren't provided
          try {
            const segRegex = /<segment:\s*([^>]+)>\s*([\s\S]*?)\s*<\/segment:[^>]*>/gi;
            const parsed: { title: string; content: string }[] = [];
            let m: RegExpExecArray | null;
            while ((m = segRegex.exec(text)) !== null) {
              parsed.push({ title: m[1].trim(), content: m[2].trim() });
            }
            if (parsed.length > 0) setSegments(parsed);
          } catch (e) {
            console.error('Failed to parse segments from reportData.text', e);
          }
        }
      } catch (err) {
        console.error("Failed to parse reportData from localStorage", err);
      }
    }
  }, []);
  
  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-sans bg-gray-50">
      <MenuBar />
      <div ref = {reportRef} id="report-content" className="flex flex-col w-full max-w-5xl p-6 space-y-8">
        {/* Summary */}
        <div className="bg-white p-5 rounded-lg shadow-md max-h-[300px] overflow-auto break-words">
          <h2 className="text-2xl mt-0 pt-0 font-bold text-center">Conversation Summary</h2>
          <div dangerouslySetInnerHTML={{ __html: marked.parse(summary) }} />
        </div>

        {/* Scoring */}
        <div className="bg-white p-5 rounded-lg shadow-md max-h-[500px] overflow-auto break-words">
          <h2 className="text-2xl mt-0 pt-0 font-bold text-center">Evaluation</h2>
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
        {/* Feedback */}
        <div className="bg-white p-5 rounded-lg shadow-md max-h-[450px] overflow-auto break-words">
          <h2 className="text-2xl mt-0 pt-0 font-bold text-center">Feedback</h2>
          <div dangerouslySetInnerHTML={{ __html: marked.parse(feedback) }} />
        </div>
      <AnnotatedTranscript segments={segments} />
      </div>
      <button
        onClick={()=>window.print()}
        className = "px-3 py-1 mb-6 bg-blue-600 text-white rounded"
      >Print Report</button>
    </div>
  );
}