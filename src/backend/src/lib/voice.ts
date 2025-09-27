import { billAgent } from "../mastra/agents/billAgent";
import { Readable } from "stream";

export async function handleVoiceRequest(audioBlob: Blob, context: string) {
  // 1. Transcribe audio

  // Convert browser ReadableStream to Node.js Readable

  async function blobToNodeStream(blob: Blob): Promise<Readable> {
    const arrayBuffer = await blob.arrayBuffer();
    return Readable.from(Buffer.from(arrayBuffer));
  }

  const nodeStream = await blobToNodeStream(audioBlob);
  const transcription = (await billAgent.voice.listen(nodeStream)) as string;

  // 2. Add context to the conversation
  const contextData = JSON.parse(context);
  const systemMessage = `Additional context: ${JSON.stringify(contextData)}`;

  // 3. Generate response with agent
  const response = await billAgent.generate([
    { role: "system", content: systemMessage },
    { role: "user", content: transcription },
  ]);

  // 4. Convert to speech
  const speech = await billAgent.voice.speak(response.text);

  return {
    transcription: transcription,
    text: response.text,
    audioData: speech,
    audioFormat: "mp3",
  };
}
