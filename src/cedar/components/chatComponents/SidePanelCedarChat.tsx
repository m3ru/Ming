import React from "react";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCedarStore } from "cedar-os";
import "dotenv/config";

// import { mastra } from "../../../backend/src/mastra";
import { contextForAnalysis } from "../../../backend/src/lib/scenarioUtil";
import { Scenarios } from "../../../backend/src/lib/scenarios";

import { SidePanelContainer } from "@/cedar/components/structural/SidePanelContainer";
import { CollapsedButton } from "@/cedar/components/chatMessages/structural/CollapsedChatButton";
import { ChatInput } from "@/cedar/components/chatInput/ChatInput";
import ChatBubbles from "@/cedar/components/chatMessages/ChatBubbles";
import Container3D from "@/cedar/components/containers/Container3D";
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

// Patch Cedar's sendMessage to prepend doc names if contextDocs is non-empty (patch only once, outside component)
const cedarStoreGlobal = useCedarStore.getState();
// Use type assertion to allow custom property
const storeWithPatchFlag = cedarStoreGlobal as typeof cedarStoreGlobal & {
  _sendMessagePatched?: boolean;
};
if (!storeWithPatchFlag._sendMessagePatched) {
  const origSend = cedarStoreGlobal.sendMessage;
  storeWithPatchFlag.sendMessage = (msg, ...args) => {
    // Always get the latest contextDocs and documents from the store
    const state = useCedarStore.getState();
    const contextDocsVal: number[] =
      ((state as any)["contextDocs"] as number[]) || [];
    const documentsVal =
      ((state as any)["documents"] as Array<{ title: string }>) || [];
    if (
      typeof msg === "string" &&
      contextDocsVal &&
      contextDocsVal.length > 0 &&
      documentsVal.length > 0
    ) {
      const docNames = contextDocsVal
        .map((idx: number) => documentsVal[idx]?.title)
        .filter(Boolean)
        .join(", ");
      if (docNames && !(msg as string).startsWith("re: (")) {
        msg = `re: (${docNames}) ${msg}` as any;
      }
    }
    return origSend(msg as any, ...args);
  };
  storeWithPatchFlag._sendMessagePatched = true;
}

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
  documents?: Array<{
    title: string;
    type: string;
    content: Array<{ format: string; content: string }>;
  }>;
}

export const SidePanelCedarChat: React.FC<SidePanelCedarChatProps> = ({
  children, // Page content
  side = "right",
  title = "Chat",
  collapsedLabel = "Start with Hello.",
  showCollapsedButton = true,
  companyLogo,
  dimensions = {
    width: 350,
    minWidth: 300,
    maxWidth: 340,
  },
  resizable = true,
  className = "",
  topOffset = 0,
  stream = true,
  documents = [],
}) => {
  // Get showChat state and setShowChat from store
  const showChat = useCedarStore((state) => state.showChat);
  const setShowChat = useCedarStore((state) => state.setShowChat);
  const router = useRouter();
  const currentThreadId = useCedarStore((state) => state.getCurrentThreadId);
  const { messages } = useThreadMessages();

  // Generate transcript string in the format: user: .../bill: ...
  const transcript = messages
    .map((m) => {
      if (m.role === "user") return `user: ${m.content}`;
      if (m.role === "assistant" || m.role === "bot")
        return `bill: ${m.content}`;
      return null;
    })
    .filter(Boolean)
    .join("\n");

  // Persistent resourceId per session (like SimpleChatPanel)
  const [resourceId, setResourceId] = useState(() => {
    if (typeof window === "undefined") return "";
    let id = localStorage.getItem("cedar_resourceId");
    if (!id) {
      id = Array.from({ length: 20 }, () =>
        Math.floor(Math.random() * 36).toString(36)
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

  // Register scenario documents as state for Cedar
  const [cedarDocuments, setCedarDocuments] = useState(documents);
  useRegisterState({
    key: "documents",
    description: "Scenario documents available for mention in chat",
    value: cedarDocuments,
    setValue: setCedarDocuments,
  });

  // Get contextDocs (indices of docs in context) from Cedar state
  const [contextDocs] = useCedarState({ key: "contextDocs", initialValue: [] });

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

  // Custom onSend handler is no longer needed; sendMessage patch handles doc prepending

  const [showSpinner, setShowSpinner] = useState(false);
  const [hideCompletely, setHideCompletely] = useState(false);

  const handleStop = async () => {
    setShowSpinner(true);
    setShowChat(false); // Hide the chat panel so spinner is fully visible
    setHideCompletely(true); // Hide the collapsed button as well
    try {
      // Use the current thread ID as the run ID to link conversation requests
      const workflowId = "feedbackOrchestratorWorkflow";
      const runId = currentThreadId || resourceId; // Use threadId first, fallback to resourceId

      // Step 1: Initialize the workflow run
      const createResponse = await fetch(
        `http://localhost:4111/api/workflows/${workflowId}/create-run?runId=${runId}`,
        {
          method: "POST",
          headers: { accept: "*/*" },
        }
      );

      if (!createResponse.ok) {
        throw new Error(
          `Failed to create workflow run: ${createResponse.statusText}`
        );
      }

      // Step 2: Start the workflow with transcript and context
      const startResponse = await fetch(
        `http://localhost:4111/api/workflows/${workflowId}/start?runId=${runId}`,
        {
          method: "POST",
          headers: {
            accept: "*/*",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputData: {
              transcript: transcript,
              additionalContext: {
                scenario: contextForAnalysis(Scenarios.demandingClient),
                participants: ["user", "bill"],
                meetingType: "project_review",
              },
              resourceId: resourceId,
              threadId: currentThreadId,
            },
          }),
        }
      );

      if (!startResponse.ok) {
        throw new Error(
          `Failed to start workflow: ${startResponse.statusText}`
        );
      }

      // Step 3: Poll for execution result (takes ~10 seconds, ~2 attempts)
      let data = null;
      let attempts = 0;
      const maxAttempts = 10; // Allow up to 10 attempts (50 seconds max)
      const pollInterval = 5000; // Poll every 5 seconds

      while (attempts < maxAttempts) {
        attempts++;
        console.log(`Polling for execution result, attempt ${attempts}...`);

        const resultResponse = await fetch(
          `http://localhost:4111/api/workflows/${workflowId}/runs/${runId}/execution-result`,
          {
            method: "GET",
            headers: { accept: "*/*" },
          }
        );

        if (!resultResponse.ok) {
          throw new Error(
            `Failed to get execution result: ${resultResponse.statusText}`
          );
        }

        const result = await resultResponse.json();

        // Check if we have actual execution results
        if (result.result && Object.keys(result.result).length > 0) {
          console.log("✅ Got execution results!", result);
          data = result;
          break;
        }

        // If not the last attempt, wait before polling again
        if (attempts < maxAttempts) {
          console.log(
            `No results yet, waiting ${pollInterval / 1000} seconds...`
          );
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }
      }

      if (!data) {
        throw new Error(
          `Workflow execution timed out after ${maxAttempts} attempts`
        );
      }

      localStorage.setItem("reportData", JSON.stringify(data));
      router.push("/report");
    } catch (e) {
      console.error("Failed to send transcript to workflow:", e);
    } finally {
      setShowSpinner(false);
    }
  };

  return (
    <>
      {showSpinner && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80">
          <Spinner size={48} />
          <div className="mt-4 text-lg font-medium text-gray-700">
            Generating report...
          </div>
          <div className="flex flex-col items-center mt-6">
            <Image
              src="/bill.png.jpeg"
              alt="Bill walking back to his office"
              width={120}
              height={120}
              className="rounded-md shadow"
            />
            <div className="mt-2 text-base text-center text-gray-600">
              Bill is walking back to his office
            </div>
          </div>
        </div>
      )}
      {/* {showCollapsedButton && !hideCompletely && (
						<AnimatePresence mode='wait'>
							{!showChat && (
								<CollapsedButton
									side={side}
									label={collapsedLabel}
									onClick={() => setShowChat(true)}
									layoutId='cedar-sidepanel-chat'
									position='fixed'
								/>
							)}
						</AnimatePresence>
					)} */}

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 z-20 flex flex-row items-center justify-between py-2 min-w-0 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center min-w-0 flex-1">
            {companyLogo && (
              <div className="flex-shrink-0 w-6 h-6 mr-2">{companyLogo}</div>
            )}
            <span className="font-bold text-lg truncate">{title}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="destructive" onClick={handleStop} className="">
              End Scenario
            </Button>
            {/* <button
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                  onClick={() => setShowChat(false)}
                  aria-label="Close chat"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button> */}
          </div>
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
