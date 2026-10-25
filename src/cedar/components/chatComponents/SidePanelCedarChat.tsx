import React, { useEffect, useRef } from "react";
import { useCedarStore } from "cedar-os";
import "dotenv/config";
import Parser from "@/app/report/parser";
import { recordCompletedScenario } from "@/lib/completedScenarios";
import { buildReportTranscript } from "@/lib/reportTranscript";
import { ChatInput } from "@/cedar/components/chatInput/ChatInput";
import ChatBubbles from "@/cedar/components/chatMessages/ChatBubbles";
import { useThreadMessages } from "cedar-os";
import { useState } from "react";
import {
  useRegisterState,
  useStateBasedMentionProvider,
  useCedarState,
} from "cedar-os";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/shadcn-io/spinner";
import Image from "next/image";
import { contextForAnalysis } from "@/lib/scenarioUtil";
import { Scenarios } from "@/backend/src/lib/scenarios";
import { analyzeSentiment, type Sentiment } from "@/lib/sentiment";
import { useSubscribeStateToAgentContext } from "cedar-os";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import type { Scenario } from "@/lib/types";

interface SidePanelCedarChatProps {
  children?: React.ReactNode; // Page content to wrap
  side?: "left" | "right";
  title?: string;
  collapsedLabel?: string;
  showCollapsedButton?: boolean; // Control whether to show the collapsed button
  companyLogo?: React.ReactNode;
  dimensions?: {
    width?: number;
    minWidth?: number;
    maxWidth?: number;
  };
  resizable?: boolean;
  className?: string; // Additional CSS classes for positioning
  topOffset?: number; // Top offset in pixels (e.g., for navbar height)
  stream?: boolean; // Whether to use streaming for responses
  scenario?: Scenario;
  documents?: Array<{
    title: string;
    type: string;
    content: Array<{ format: string; content: string }>;
  }>;
}

export const SidePanelCedarChat: React.FC<
  SidePanelCedarChatProps & {
    setUserSentiment: (sentiment: Sentiment) => void;
  }
> = ({
  title = "Live transcript",
  companyLogo,
  stream = true,
  documents = [],
  scenario,
  setUserSentiment,
}) => {
  const router = useRouter();
  const voiceSession = useVoiceSession();
  const [stopError, setStopError] = useState<string | null>(null);
  const currentThreadId = useCedarStore((state) => state.mainThreadId);
  const { messages } = useThreadMessages();
  const isProcessing = useCedarStore((state) => state.isProcessing);
  const finishing = useRef<AbortController | null>(null);
  useEffect(() => () => finishing.current?.abort(), []);

  // Persistent resourceId per session (like SimpleChatPanel)
  const [resourceId, setResourceId] = useState(() => {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem("cedar_resourceId");
    if (!id) {
      id = Array.from({ length: 20 }, () =>
        Math.floor(Math.random() * 36).toString(36),
      ).join("");
      localStorage.setItem("cedar_resourceId", id);
    }
    return id;
  });

  // Register resourceId with Cedar
  useRegisterState({
    key: "resourceId",
    description: "A persistent resource/session ID for the chat session",
    value: resourceId,
    setValue: setResourceId,
  });

  // Register scenario context marker
  useRegisterState({
    key: "scenarioContext",
    description: "Marker to indicate we're in scenario chat context",
    value: "bill_scenario",
    setValue: () => {},
  });

  // Subscribe scenario context to agent
  useSubscribeStateToAgentContext(
    "scenarioContext",
    (context) => ({
      chatType: "scenario",
      scenarioType: context,
    }),
    {
      showInChat: false,
      color: "#3557c8",
    },
  );

  // Register scenario documents as state for Cedar
  const [cedarDocuments, setCedarDocuments] = useState(documents);
  useEffect(() => {
    setCedarDocuments(documents);
  }, [documents]);
  useRegisterState({
    key: "scenarioDetails",
    description: "The active training scenario",
    value: scenario,
    setValue: () => {},
  });
  useSubscribeStateToAgentContext(
    "scenarioDetails",
    (value) => ({ scenarioDetails: value }),
    { showInChat: false },
  );
  useRegisterState({
    key: "documents",
    description: "Scenario documents available for mention in chat",
    value: cedarDocuments,
    setValue: setCedarDocuments,
  });

  // Initialize the document mention selection in Cedar state.
  useCedarState({ key: "contextDocs", initialValue: [] });

  // Register mention provider for scenario documents
  useStateBasedMentionProvider({
    stateKey: "documents",
    trigger: "@",
    labelField: "title",
    searchFields: ["title", "type"],
    description: "Documents",
    icon: (
      <svg
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="2" width="13" height="14" rx="2" />
        <path d="M8 2v14" />
      </svg>
    ),
    color: "#3557c8",
    order: 5,
  });

  // Subscribe scenario context to agent - this tells the backend to use billPrompt
  useSubscribeStateToAgentContext(
    "documents",
    (documents) => ({
      chatContext: "scenario",
      promptType: "bart",
      scenarioDocuments: documents,
      resourceId: resourceId,
    }),
    {
      showInChat: false,
      color: "#3557c8",
    },
  );

  const [showSpinner, setShowSpinner] = useState(false);

  const handleStop = async () => {
    if (finishing.current || isProcessing) return;
    const controller = new AbortController();
    finishing.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);
    setShowSpinner(true);
    setStopError(null);
    try {
      try {
        await voiceSession.stop();
      } catch {
        setStopError(voiceSession.provider === "deepgram"
          ? "Voice could not finish. Retry the recording, or select Continue by text to discard the failed recording before ending the conversation."
          : "The voice transcript could not finish saving. Your conversation is still here. Select End conversation to try saving it again.");
        return;
      }
      const finalTranscript = buildReportTranscript(
        useCedarStore.getState().getThreadMessages(currentThreadId),
      );
      if (!finalTranscript) {
        setStopError("Talk with Bart before ending the conversation. Send a message and wait for his reply.");
        return;
      }
      const response = await fetch("/api/backend/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          threadId: currentThreadId,
          transcript: finalTranscript,
          additionalContext: {
            scenario: contextForAnalysis(scenario ?? Scenarios.negativeReview),
            participants: ["user", "bart"],
            meetingType: "project_review",
          },
        }),
      });
      if (!response.ok) throw new Error("Report service unavailable");
      const result = await response.json() as {
        status: string;
        result?: { summaryAnalysis?: string; detailedFeedback?: string; segmentedAnalysis?: string };
      };
      if (controller.signal.aborted) return;
      if (result.status !== "success") {
        setStopError("The report could not be generated. Your conversation is still here. Select End conversation to try again.");
        return;
      }
      const savedReport = JSON.stringify({
        summary: result.result?.summaryAnalysis,
        detail: result.result?.detailedFeedback,
        analysis: result.result?.segmentedAnalysis,
        sessionId: currentThreadId,
        transcript: finalTranscript,
        createdAt: new Date().toISOString(),
      });
      const parsedReport = Parser(savedReport);
      if (parsedReport.status === "invalid" || !parsedReport.summary || !parsedReport.segments.length) {
        setStopError("The report was incomplete. Your conversation is still here. Select End conversation to try again.");
        return;
      }
      try {
        localStorage.setItem("reportData", savedReport);
        recordCompletedScenario(localStorage, currentThreadId);
      } catch {
        setStopError("The report could not be saved in this browser. Allow site storage, then select End conversation to try again.");
        return;
      }
      router.push("/report");
    } catch {
      setStopError(controller.signal.aborted
        ? "Report generation stopped. Your conversation is still here. Select End conversation to try again."
        : "The report service is unavailable. Your conversation is still here. Select End conversation to try again.");
    } finally {
      clearTimeout(timeout);
      if (finishing.current === controller) finishing.current = null;
      setShowSpinner(false);
    }
  };

  const sentimentText = messages
    .filter((message) => message.role === "user" && message.type === "text")
    .slice(-3)
    .map((message) => message.content)
    .filter(Boolean)
    .join(" ")
    .slice(-12000)
    .trim();

  useEffect(() => {
    if (!sentimentText) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void analyzeSentiment(sentimentText, controller.signal)
        .then((sentiment) => {
          if (!controller.signal.aborted) setUserSentiment(sentiment);
        })
        .catch(() => {
          /* Keep the last score if scoring fails; voice and reports continue. */
        });
    }, 1000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [sentimentText, setUserSentiment]);

  return (
    <>
      {showSpinner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 p-4">
          <div className="flex w-full max-w-sm flex-col items-center rounded-xl border border-rule bg-white px-6 py-8 text-center shadow-xl shadow-ink/10">
            <Spinner size={40} className="text-pencil" />
            <p role="status" className="mt-4 text-lg font-bold text-ink">
              Writing your debrief…
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => finishing.current?.abort()}
            >
              Cancel report
            </Button>
            <Image
              src="/bill.png.jpeg"
              alt=""
              width={120}
              height={120}
              className="mt-6 rounded-lg"
            />
            <p className="hand mt-2 -rotate-2 text-[28px] text-ink-soft">
              Bart is walking back to his office
            </p>
          </div>
        </div>
      )}
      <div className="flex h-[70vh] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-rule bg-white lg:h-auto lg:min-h-0">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="flex min-w-0 items-center">
            {companyLogo && (
              <div className="mr-2 size-6 shrink-0">{companyLogo}</div>
            )}
            <h2 className="truncate text-lg font-extrabold tracking-tight text-ink">
              {title}
            </h2>
          </div>
          <Button
            variant="outline"
            onClick={handleStop}
            disabled={showSpinner || isProcessing}
            className="shrink-0 cursor-pointer border-red-pencil bg-white text-red-pencil shadow-none hover:bg-red-pencil hover:text-white"
          >
            End conversation
          </Button>
        </div>
        {stopError && (
          <p
            role="alert"
            className="shrink-0 border-b border-rule bg-red-pencil/5 px-4 py-2 text-sm text-red-pencil"
          >
            {stopError}
          </p>
        )}

        {/* Chat messages - takes up remaining space */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatBubbles />
        </div>

        {/* Chat input - fixed at bottom */}
        <div className="shrink-0 p-3 pt-1">
          <ChatInput
            handleFocus={() => {}}
            handleBlur={() => {}}
            isInputFocused={false}
            stream={stream}
          />
        </div>
      </div>
    </>
  );
};
