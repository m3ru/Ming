"use client";

import { createContext, useContext, useState } from "react";
import { useCedarStore } from "cedar-os";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { createSessionStarter } from "@/lib/practiceSession";
import type { Scenario } from "@/lib/types";

type SessionActions = {
  startNewSession: (scenario?: Scenario) => Promise<void>;
  isStarting: boolean;
  error: string | null;
};

const SessionActionsContext = createContext<SessionActions | null>(null);

export function SessionActionsProvider({ children }: { children: React.ReactNode }) {
  const voice = useVoiceSession();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startNewSession] = useState(() => createSessionStarter({
    isProcessing: () => useCedarStore.getState().isProcessing,
    stopVoice: voice.stop,
    storage: () => window.sessionStorage,
    navigate: (path) => window.location.assign(path),
    onStarting: setIsStarting,
    onError: setError,
  }));

  return (
    <SessionActionsContext.Provider value={{ startNewSession, isStarting, error }}>
      {children}
    </SessionActionsContext.Provider>
  );
}

export function useSessionActions() {
  const actions = useContext(SessionActionsContext);
  if (!actions) throw new Error("SessionActionsProvider is missing");
  return actions;
}
