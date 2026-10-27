import type { VoiceProvider } from "./voiceProvider";

export type AvatarProvider = "simli";

/** Only a provider name crosses the server/client boundary; never API keys. */
export function resolveAvatarProvider(value?: string): AvatarProvider | null {
  const provider = value?.trim().toLowerCase() || "none";
  if (provider === "none") return null;
  if (provider !== "simli") {
    throw new Error("MING_AVATAR_PROVIDER must be simli or none.");
  }
  return provider;
}

/**
 * The live avatar lip-syncs Bart's streamed voice track, which only the default
 * streaming voice provides. Other voice modes keep the standard call tile.
 */
export function liveAvatarFor(
  voice: VoiceProvider,
  avatar: AvatarProvider | null,
): AvatarProvider | null {
  return voice === "openai" ? avatar : null;
}
