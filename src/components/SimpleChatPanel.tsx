import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import StopButton from "./StopButton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Image from "next/image";
// ...existing code...
type MessageRole = "user" | "assistant";
interface Message {
  id: number;
  text: string;
  role: MessageRole;
}

export default function SimpleChatPanel() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [transcript, setTranscript] = useState("");
  const [analyzerResponse, setAnalyzerResponse] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Update transcript string whenever messages changes
  useEffect(() => {
    const lines = messages.map((m) =>
      m.role === "user" ? `user: ${m.text}` : `bill: ${m.text}`
    );
    setTranscript(lines.join("\n"));
  }, [messages]);

  // Handler for StopButton
  const handleStop = async () => {
    try {
      const response = await fetch("http://localhost:4111/api/agents/transcriptSummaryAnalyzerAgent/generate/vnext", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: transcript,
            },
          ],
        }),
      });
      const data = await response.json();
      setAnalyzerResponse(data);
      localStorage.setItem("reportData", JSON.stringify(data));
      console.log("Analyzer response:", data);
      router.push("/report");
    } catch (e) {
      console.error("Failed to send transcript to analyzer:", e);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (input.trim() === "") return;
    const userMessage: Message = { id: Date.now(), text: input, role: "user" };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setStatus("sending");

    // Convert to backend format
    const backendMessages = newMessages.map((m) => ({
      role: "user",
      content: m.text,
    }));

    try {
      const response = await fetch(
        "http://localhost:4111/api/agents/billAgent/generate/vnext",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: backendMessages }),
        }
      );
      if (!response.ok) throw new Error("Failed to export chat");
      const data = await response.json();
      // Try to extract the assistant's reply from the response
      let assistantText = "";
      if (data.text) {
        assistantText = data.text;
      } else if (
        data.response &&
        data.response.messages &&
        data.response.messages.length > 0
      ) {
        // Try to get from response.messages[0].content[0].text
        const msg = data.response.messages.find(
          (m: any) => m.role === "assistant"
        );
        if (
          msg &&
          msg.content &&
          msg.content.length > 0 &&
          msg.content[0].text
        ) {
          assistantText = msg.content[0].text;
        }
      }
      if (assistantText) {
        setMessages((msgs) => [
          ...msgs,
          { id: Date.now() + 1, text: assistantText, role: "assistant" },
        ]);
      }
      setStatus("success");
    } catch (e) {
      setStatus("error");
    } finally {
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <Card className="flex flex-col h-full max-w-md mx-auto">
      <div className="flex justify-end p-2">
        <StopButton onStop={handleStop} />
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg) => (
          msg.role === "assistant" ? (
            <div key={msg.id} className="flex items-start gap-2 self-start">
              <Image
                src="https://randomuser.me/api/portraits/men/1.jpg"
                alt="Assistant profile"
                width={32}
                height={32}
                className="rounded-full border"
              />
              <div className="bg-gray-100 text-gray-900 rounded px-3 py-2 w-fit max-w-full">
                {msg.text}
              </div>
            </div>
          ) : (
            <div
              key={msg.id}
              className="bg-blue-100 text-blue-900 rounded px-3 py-2 w-fit max-w-full self-end"
            >
              {msg.text}
            </div>
          )
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form
        onSubmit={handleSend}
        className="flex p-2 border-t gap-2 bg-background"
      >
        <Input
          className="flex-1"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Respond..."
        />
        <Button type="submit" disabled={!input.trim()}>
          Send
        </Button>
      </form>
      <div className="flex justify-end p-2 text-xs text-gray-500 h-4 min-h-[1rem]">
        {status === "sending" && "Saving..."}
        {status === "success" && "Saved!"}
        {status === "error" && "Failed to save."}
      </div>
    </Card>
  );
}
