"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { useCedarStore } from "cedar-os";
import { LiveVoiceController } from "@/lib/liveVoice";
import { DeepgramVoiceController } from "@/lib/deepgramVoice";
import { isChatErrorMessage } from "@/lib/chatErrors";
import type { ConversationMessage } from "@/lib/voiceTranscript";

type VoiceSessionController = Pick<
  LiveVoiceController,
  | "getSnapshot"
  | "subscribe"
  | "start"
  | "stop"
  | "flush"
  | "beginTalking"
  | "endTalking"
  | "resumePlayback"
  | "syncContext"
  | "syncTypedMessages"
  | "dispose"
> & {
  canContinueByText?: () => boolean;
  continueByText?: () => Promise<void>;
  // Streaming voice only: lets a synced video renderer play Bart's voice.
  subscribeRemoteAudio?: LiveVoiceController["subscribeRemoteAudio"];
  routeOutput?: LiveVoiceController["routeOutput"];
  subscribeCensor?: LiveVoiceController["subscribeCensor"];
};
type VoiceProvider = "openai" | "deepgram";
const VoiceContext = createContext<{
  controller: VoiceSessionController;
  provider: VoiceProvider;
} | null>(null);
function messages(threadId: string): ConversationMessage[] {
  return useCedarStore
    .getState()
    .getThreadMessages(threadId)
    .filter(
      (message) =>
        message.type === "text" &&
        !isChatErrorMessage(message) &&
        message.metadata?.generationFailed !== true &&
        (message.role === "user" ||
          message.role === "assistant" ||
          message.role === "bot"),
    )
    .map((message) => ({
      id: message.id,
      role: message.role === "user" ? "user" : "assistant",
      content: message.content ?? "",
      metadata:
        message.metadata?.source === "live-voice"
          ? message.metadata
          : undefined,
      createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
    }));
}

export function VoiceSessionProvider({
  children,
  provider = "openai",
}: {
  children: React.ReactNode;
  provider?: VoiceProvider;
}) {
  const pathname = usePathname();
  const [session] = useState(() => {
    const Controller =
      provider === "deepgram" ? DeepgramVoiceController : LiveVoiceController;
    const byTime = (a: { createdAt?: string }, b: { createdAt?: string }) =>
      new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
    // The thread whose streaming message was kept last, to put in time order once it finishes.
    let pinnedThread: string | undefined;
    return {
      provider,
      resortPinned: () => {
        if (pinnedThread === undefined) return;
        const state = useCedarStore.getState();
        state.setMessages([...state.getThreadMessages(pinnedThread)].sort(byTime), pinnedThread);
        pinnedThread = undefined;
      },
      controller: new Controller({
        baseURL: () => {
          const config = useCedarStore.getState().providerConfig;
          return (
            (config && "baseURL" in config ? config.baseURL : undefined) ||
            "/api/backend"
          );
        },
        scope: () => {
          const state = useCedarStore.getState();
          const threadId = state.getCurrentThreadId();
          return {
            threadId,
            resourceId: String(state.getCedarState("userId") ?? ""),
            context: state.compileAdditionalContext(),
            messages: messages(threadId),
          };
        },
        messages,
        transcript: (threadId, sessionId, transcript) => {
          const state = useCedarStore.getState();
          const thread = state.getThreadMessages(threadId);
          // Cedar streams a typed reply into whatever message is last. Keep that message
          // last until it finishes, so voice lines neither split it nor receive its text,
          // while the store stays current for saves and the next voice turn's history.
          const last = thread.at(-1);
          const streaming =
            state.isProcessing &&
            threadId === state.mainThreadId &&
            last?.metadata?.sessionId !== sessionId
              ? last
              : undefined;
          if (streaming) pinnedThread = threadId;
          state.setMessages(
            [
              ...thread.filter(
                (message) =>
                  message !== streaming && message.metadata?.sessionId !== sessionId,
              ),
              ...transcript.map((message) => ({
                ...message,
                type: "text" as const,
              })),
            ]
              .sort(byTime)
              .concat(streaming ? [streaming] : []),
            threadId,
          );
          try {
            localStorage.setItem(
              "ming-transcript-" + threadId,
              JSON.stringify(state.getThreadMessages(threadId)),
            );
          } catch {
            /* Cedar still retains the transcript if browser storage is full. */
          }
        },
      }),
    };
  });
  const { controller, resortPinned } = session;

  useEffect(() => {
    const unsubscribe = useCedarStore.subscribe((state, previous) => {
      if (state.additionalContext !== previous.additionalContext)
        controller.syncContext();
      if (previous.isProcessing && !state.isProcessing) resortPinned();
      if (state.mainThreadId !== previous.mainThreadId)
        void controller.stop().catch(() => {});
      else if (
        !state.isProcessing &&
        (state.messages !== previous.messages || previous.isProcessing)
      )
        controller.syncTypedMessages();
    });
    const unload = () => controller.dispose();
    window.addEventListener("pagehide", unload);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", unload);
      controller.dispose();
    };
  }, [controller, resortPinned]);

  useEffect(
    () => () => {
      void controller.stop().catch(() => {});
    },
    [pathname, controller],
  );
  return (
    <VoiceContext.Provider value={session}>{children}</VoiceContext.Provider>
  );
}

export function useVoiceSession() {
  const session = useContext(VoiceContext);
  if (!session) throw new Error("VoiceSessionProvider is missing");
  const { controller, provider } = session;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return {
    ...state,
    provider,
    start: controller.start,
    stop: controller.stop,
    flush: controller.flush,
    beginTalking: controller.beginTalking,
    endTalking: controller.endTalking,
    resumePlayback: controller.resumePlayback,
    canContinueByText: controller.canContinueByText?.() ?? false,
    continueByText: controller.continueByText,
    subscribeRemoteAudio: controller.subscribeRemoteAudio,
    routeOutput: controller.routeOutput,
    subscribeCensor: controller.subscribeCensor,
  };
}
