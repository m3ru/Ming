"use client";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CedarCopilot, ProviderConfig } from "cedar-os";
import { messageRenderers } from "@/cedar/messageRenderers";
import MenuBar from "@/components/MenuBar";
import { useState } from "react";
import { VoiceSessionProvider } from "@/hooks/useVoiceSession";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function generateRandomId(): string {
  return "xxxxxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c == "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    },
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [userId] = useState(generateRandomId);
  const [threadId] = useState(generateRandomId);
  const llmProvider: ProviderConfig = {
    provider: "mastra" as const,
    baseURL: process.env.NEXT_PUBLIC_URL || "http://localhost:4111",
  };

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CedarCopilot
          userId={userId}
          threadId={threadId}
          llmProvider={llmProvider}
          messageRenderers={messageRenderers}
        >
          <VoiceSessionProvider>
            <MenuBar />
            {children}
          </VoiceSessionProvider>
        </CedarCopilot>
      </body>
    </html>
  );
}
