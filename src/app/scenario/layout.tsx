import { LiveAvatarProvider } from "@/hooks/useLiveAvatar";
import { liveAvatarFor, resolveAvatarProvider } from "@/lib/avatarProvider";
import { resolveVoiceProvider } from "@/lib/voiceProvider";

export const dynamic = "force-dynamic";

// Reads the operator's choice on the server at request time, like the voice
// provider in the root layout. Keys and face IDs never reach the browser.
export default function ScenarioLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const provider = liveAvatarFor(
    resolveVoiceProvider(process.env.MING_VOICE_PROVIDER),
    resolveAvatarProvider(process.env.MING_AVATAR_PROVIDER),
  );
  return <LiveAvatarProvider provider={provider}>{children}</LiveAvatarProvider>;
}
