import React, { useEffect } from "react";
import { X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useCedarStore } from "cedar-os";
import "dotenv/config";
import { mastraClient } from "@/lib/mastra-client";
import { SidePanelContainer } from "@/cedar/components/structural/SidePanelContainer";
import { CollapsedButton } from "@/cedar/components/chatMessages/structural/CollapsedChatButton";
import { ChatInput } from "@/cedar/components/chatInput/ChatInput";
import ChatBubbles from "@/cedar/components/chatMessages/ChatBubbles";
import Container3D from "@/cedar/components/containers/Container3D";
import { useThreadMessages } from "cedar-os";
import { useState, useCallback } from "react";
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
import { analyzeSentiment, Sentiment } from "@/lib/googleSentiment";
import { useSubscribeStateToAgentContext } from "cedar-os";
import { Separator } from "@/components/ui/separator";
import { billPrompt } from "@/lib/prompts";

// Patch Cedar's sendMessage to prepend document references only (patch only once, globally)
const cedarStoreGlobal = useCedarStore.getState();
// Use type assertion to allow custom property
const storeWithPatchFlag = cedarStoreGlobal as typeof cedarStoreGlobal & {
  _sendMessageDocPatchPatched?: boolean;
};
if (!storeWithPatchFlag._sendMessageDocPatchPatched) {
  const origSend = cedarStoreGlobal.sendMessage;
  storeWithPatchFlag.sendMessage = (msg, ...args) => {
    if (typeof msg === "string") {
      let modifiedMsg = msg as string;
      
      // Always get the latest contextDocs and documents from the store
      const state = useCedarStore.getState();
      const contextDocsVal: number[] =
        ((state as any)["contextDocs"] as number[]) || [];
      const documentsVal =
        ((state as any)["documents"] as Array<{ title: string }>) || [];
      
      // Prepend document references if they exist
      if (
        contextDocsVal &&
        contextDocsVal.length > 0 &&
        documentsVal.length > 0
      ) {
        const docNames = contextDocsVal
          .map((idx: number) => documentsVal[idx]?.title)
          .filter(Boolean)
          .join(", ");
        if (docNames && !modifiedMsg.startsWith("re: (")) {
          modifiedMsg = `re: (${docNames}) ${modifiedMsg}`;
        }
      }
      
      msg = modifiedMsg as any;
    }
    return origSend(msg as any, ...args);
  };
  storeWithPatchFlag._sendMessageDocPatchPatched = true;
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

export const SidePanelCedarChat: React.FC<
  SidePanelCedarChatProps & {
    setUserSentiment: (sentiment: Sentiment) => void;
    setBotSentiment: (sentiment: Sentiment) => void;
  }
> = ({
  children, // Page content
  side = "right",
  title = "Transcript",
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
  setUserSentiment,
  setBotSentiment,
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
      // Skip messages with undefined/empty content or tool-related messages
      if (
        !m.content ||
        m.content.trim() === "" ||
        m.type === "tool-call" ||
        m.type === "tool-result"
      ) {
        return null;
      }
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

  // Register scenario context marker
  useRegisterState({
    key: "scenarioContext",
    description: "Marker to indicate we're in scenario chat context",
    value: "bill_scenario",
    setValue: () => {},
  });

  // Subscribe scenario context to agent
  useSubscribeStateToAgentContext(
    'scenarioContext',
    (context) => ({
      chatType: 'scenario',
      scenarioType: context
    }),
    {
      showInChat: false,
      color: '#8b5cf6',
    }
  );

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

  // Subscribe scenario context to agent - this tells the backend to use billPrompt
  useSubscribeStateToAgentContext(
    "documents",
    (documents) => ({
      chatContext: "scenario",
      promptType: "bill",
      scenarioDocuments: documents,
      resourceId: resourceId,
    }),
    {
      showInChat: false,
      color: "#8b5cf6",
    }
  );

  // Custom onSend handler is no longer needed; sendMessage patch handles doc prepending

  const [showSpinner, setShowSpinner] = useState(false);
  const [hideCompletely, setHideCompletely] = useState(false);

  const handleStop = async () => {
    setShowSpinner(true);
    setShowChat(false); // Hide the chat panel so spinner is fully visible
    setHideCompletely(true); // Hide the collapsed button as well
    try {
      // const response = await fetch('http://localhost:4111/api/agents/transcriptSummaryAnalyzerAgent/generate/vnext', {
      // 	method: 'POST',
      // 	headers: { 'Content-Type': 'application/json' },
      // 	body: JSON.stringify({
      // 		messages: [
      // 			{
      // 				role: 'user',
      // 				content: transcript,
      // 			},
      // 		],
      // 		memory: {
      // 			thread: currentThreadId,
      // 			resource: resourceId,
      // 		},
      // 	}),
      // });
      // const data = await response.json();
      // localStorage.setItem('reportData', JSON.stringify(data));
      // router.push('/report');
      const workflow = await mastraClient.getWorkflow(
        "feedbackOrchestratorWorkflow"
      );
      console.log("Workflow", workflow);
      const run = await workflow.createRunAsync();

      const result = await run.startAsync({
        inputData: {
          transcript: transcript,
          additionalContext: {
            scenario: `${contextForAnalysis(Scenarios.demandingClient)}`,
            participants: ["user", "bill"],
            meetingType: "project_review",
          },
          memory: {
            thread: currentThreadId,
            resource: resourceId,
          },
        },
      });

      console.log("Full workflow result:", result);

      // Check if the workflow succeeded before accessing the data
      if (result.status === "success") {
        const workflowOutput = result.result;
        console.log("Workflow output:", workflowOutput);
        localStorage.setItem(
          "reportData",
          JSON.stringify({
            summary: workflowOutput?.summaryAnalysis,
            detail: workflowOutput?.detailedFeedback,
            analysis: workflowOutput?.segmentedAnalysis,
          })
        );
        // Mark scenario as completed for new prompt generation
        localStorage.setItem("scenarioCompleted", "true");
        console.log(localStorage.getItem("reportData"));
        router.push("/report");
      } else if (result.status === "failed") {
        console.error("Workflow failed:", (result as any).error);
        // Handle the failure case appropriately
      } else {
        console.error("Workflow in unexpected state:", result.status);
      }
    } catch (e) {
      console.error("Failed to send transcript to analyzer:", e);
    } finally {
      setShowSpinner(false);
    }
  };

  function updateSentiment(
    set: (sentiment: Sentiment) => void,
    messageRole: string
  ) {
    const roleMessages = messages.filter((m) => m.role === messageRole);

    const lastMessages = roleMessages.slice(-3); // Get the last 3 messages

    const combinedContent = lastMessages
      .map((m) => m.content)
      .filter(Boolean)
      .join(" ");

    if (combinedContent) {
      analyzeSentiment(combinedContent).then((data) => {
        set(data);
        console.log(
          `${messageRole} sentiment analysis result:`,
          data,
          "for content:",
          combinedContent
        );
      });
    }
  }

  useEffect(() => {
    updateSentiment(setUserSentiment, "user");
    updateSentiment(setBotSentiment, "assistant");
  }, [messages]);

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
        <div className="flex flex-col">
          <div className="z-20 flex flex-row items-center justify-between flex-shrink-0 min-w-0 pb-2 ">
            <div className="flex items-center flex-1 min-w-0">
              {companyLogo && (
                <div className="flex-shrink-0 w-6 h-6 mr-2">{companyLogo}</div>
              )}
              <span className="text-lg font-bold truncate">{title}</span>
            </div>
            <div className="flex items-center flex-shrink-0 gap-2">
              <Button
                variant="destructive"
                onClick={handleStop}
                className="mr-2"
              >
                End Scenario
              </Button>
              {/* <button
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                  onClick={() => setShowChat(false)}
                  aria-label="Close chat"
                >
                  <X className="w-4 h-4" strokeWidth={2.5} />
                </button> */}
            </div>
          </div>
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
