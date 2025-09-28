"use client";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CedarCopilot, ProviderConfig } from "cedar-os";
import { messageRenderers } from "@/cedar/messageRenderers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function generateRandomId(): string {
  return 'xxxxxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const llmProvider: ProviderConfig = {
    provider: "mastra" as const,
    baseURL: process.env.NEXT_PUBLIC_MASTRA_URL || "http://localhost:4111",
  };

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CedarCopilot
          userId={generateRandomId()}
          threadId={generateRandomId()}
          llmProvider={llmProvider}
          messageRenderers={messageRenderers}
          voiceSettings={{
            language: "en-US",
            voiceId: "alloy", // OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
            useBrowserTTS: false, // Use OpenAI TTS instead of browser
            autoAddToMessages: true, // Add voice interactions to chat history
            pitch: 1.0,
            rate: 1.0,
            volume: 1.0,
            endpoint: "/chat/voice", // Optional: Custom voice endpoint
          }}
        >
          {children}
        </CedarCopilot>
      </body>
    </html>
  );
}
