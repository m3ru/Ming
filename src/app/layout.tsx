import type { Metadata } from "next";
import { Caveat, Schibsted_Grotesk } from "next/font/google";
import { MotionConfig } from "motion/react";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import { resolveVoiceProvider } from "@/lib/voiceProvider";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"] });
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ming",
  description: "Practice hard management conversations with an AI employee.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en"><body className={`${schibsted.variable} ${caveat.variable} antialiased`}>
      {/* JS-driven motion follows the OS reduced-motion setting, like the CSS rule in globals.css. */}
      <MotionConfig reducedMotion="user">
        <AppProviders voiceProvider={resolveVoiceProvider(process.env.MING_VOICE_PROVIDER)}>{children}</AppProviders>
      </MotionConfig>
    </body></html>
  );
}
