"use client";

import { createContext, useContext } from "react";
import type { AvatarProvider } from "@/lib/avatarProvider";

const LiveAvatarContext = createContext<AvatarProvider | null>(null);

export function LiveAvatarProvider({
  provider,
  children,
}: {
  provider: AvatarProvider | null;
  children: React.ReactNode;
}) {
  return (
    <LiveAvatarContext.Provider value={provider}>
      {children}
    </LiveAvatarContext.Provider>
  );
}

/** The configured live avatar provider, or null to keep the standard tile. */
export function useLiveAvatarProvider() {
  return useContext(LiveAvatarContext);
}
