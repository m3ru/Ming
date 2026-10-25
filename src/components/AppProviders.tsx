"use client";
import { useState } from "react";
import { CedarCopilot } from "cedar-os";
import { messageRenderers } from "@/cedar/messageRenderers";
import MenuBar from "@/components/MenuBar";
import { VoiceSessionProvider } from "@/hooks/useVoiceSession";
import { SessionActionsProvider } from "@/components/SessionActionsProvider";
import type { VoiceProvider } from "@/lib/voiceProvider";

export default function AppProviders({ children, voiceProvider }: { children: React.ReactNode; voiceProvider: VoiceProvider }) {
  const [threadId] = useState(() => crypto.randomUUID());
  return (
    <CedarCopilot userId="localhost-demo" threadId={threadId} llmProvider={{ provider: "mastra", baseURL: "/api/backend" }} messageRenderers={messageRenderers}>
      <VoiceSessionProvider provider={voiceProvider}>
        <SessionActionsProvider><MenuBar />{children}</SessionActionsProvider>
      </VoiceSessionProvider>
    </CedarCopilot>
  );
}
