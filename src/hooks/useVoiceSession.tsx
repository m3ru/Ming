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
    // Each call carries the whole session transcript, so only the latest per session is kept.
    const deferred = new Map<string, { threadId: string; transcript: ConversationMessage[] }>();
    const applyTranscript = (
      threadId: string,
      sessionId: string,
      transcript: ConversationMessage[],
    ) => {
      const state = useCedarStore.getState();
      const retained = state
        .getThreadMessages(threadId)
        .filter((message) => message.metadata?.sessionId !== sessionId);
      state.setMessages(
        [
          ...retained,
          ...transcript.map((message) => ({
            ...message,
            type: "text" as const,
          })),
        ].sort(
          (a, b) =>
            new Date(a.createdAt ?? 0).getTime() -
            new Date(b.createdAt ?? 0).getTime(),
        ),
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
    };
    return {
      provider,
      applyDeferred: () => {
        for (const [sessionId, { threadId, transcript }] of deferred)
          applyTranscript(threadId, sessionId, transcript);
        deferred.clear();
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
          // Cedar streams a typed reply into the last message; re-sorting now would split
          // that reply or pour it into a voice line, so wait until the reply finishes.
          if (useCedarStore.getState().isProcessing)
            deferred.set(sessionId, { threadId, transcript });
          else applyTranscript(threadId, sessionId, transcript);
        },
      }),
    };
  });
  const { controller, applyDeferred } = session;

  useEffect(() => {
    const unsubscribe = useCedarStore.subscribe((state, previous) => {
      if (state.additionalContext !== previous.additionalContext)
        controller.syncContext();
      if (previous.isProcessing && !state.isProcessing) applyDeferred();
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
  }, [controller, applyDeferred]);

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
  };
}
