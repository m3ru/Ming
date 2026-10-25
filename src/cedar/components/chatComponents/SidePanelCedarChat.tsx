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
import { Separator } from "@/components/ui/separator";
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
  title = "Transcript",
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
      color: "#8b5cf6",
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
    color: "#8b5cf6",
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
      color: "#8b5cf6",
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
          ? "Voice could not finish. Retry the recording, or select Continue by text to discard the failed recording before ending the scenario."
          : "The voice transcript could not finish saving. Your conversation is still here. Select End Scenario to try saving it again.");
        return;
      }
      const finalTranscript = buildReportTranscript(
        useCedarStore.getState().getThreadMessages(currentThreadId),
      );
      if (!finalTranscript) {
        setStopError("Have a conversation with Bart before ending the scenario. Send a message and wait for his reply.");
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
        setStopError("The report could not be generated. Your conversation is still here. Select End Scenario to try again.");
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
        setStopError("The report was incomplete. Your conversation is still here. Select End Scenario to try again.");
        return;
      }
      try {
        localStorage.setItem("reportData", savedReport);
        recordCompletedScenario(localStorage, currentThreadId);
      } catch {
        setStopError("The report could not be saved in this browser. Allow site storage, then select End Scenario to try again.");
        return;
      }
      router.push("/report");
    } catch {
      setStopError(controller.signal.aborted
        ? "Report generation stopped. Your conversation is still here. Select End Scenario to try again."
        : "The report service is unavailable. Your conversation is still here. Select End Scenario to try again.");
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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80">
          <Spinner size={48} />
          <div className="mt-4 text-lg font-medium text-gray-700">
            Generating report...
          </div>
          <Button variant="outline" className="mt-4" onClick={() => finishing.current?.abort()}>Cancel report</Button>
          <div className="flex flex-col items-center mt-6">
            <Image
              src="/bill.png.jpeg"
              alt="Bart walking back to his office..."
              width={120}
              height={120}
              className="rounded-md shadow"
            />
            <div className="mt-2 text-base text-center text-gray-600">
              Bart is walking back to his office
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex flex-col">
          <div className="z-20 flex flex-row items-center justify-between flex-shrink-0 min-w-0 pb-2 ">
            <div className="flex items-center flex-1 min-w-0">
              {companyLogo && (
                <div className="flex-shrink-0 w-6 h-6 mr-2">{companyLogo}</div>
              )}
              <span className="lg:text-lg font-bold truncate">{title}</span>
            </div>
            <div className="flex items-center flex-shrink-0 gap-2">
              <Button
                variant="destructive"
                onClick={handleStop}
                disabled={showSpinner || isProcessing}
                className="mr-2 cursor-pointer"
              >
                End Scenario
              </Button>
            </div>
          </div>
          {stopError && (
            <p role="alert" className="p-2 text-sm text-red-600">
              {stopError}
            </p>
          )}
          <Separator />
        </div>

        {/* Chat messages - takes up remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatBubbles />
        </div>

        {/* Chat input - fixed at bottom */}
        <div className="flex-shrink-0 p-1">
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
