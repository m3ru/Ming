import { Readable } from "node:stream";
import { billAgent } from "../mastra/agents/billAgent";

class AudioReadableStream extends Readable {
  constructor(private buffer: ArrayBuffer) {
    super();
    this.init();
  }

  private init() {
    this.push(Buffer.from(this.buffer));
    this.push(null); // Signal the end of the stream
  }

  _read(size: number) {
    // No-op since we push all data in init
  }
}

export async function handleVoiceRequest(audioBlob: Blob, context: string) {
  // 1. Transcribe audio

  const arrayBuffer = await audioBlob.arrayBuffer();
  const stream = new AudioReadableStream(arrayBuffer);

  // console.log("Starting transcription... Stream:", stream);
  const transcriptionObj = await billAgent.voice.listen(stream, {
    fileType: "webm",
    language: "en-US",
    encoding: "LINEAR16",
  });
  // console.log("Transcription Object:", transcriptionObj);
  const transcription = transcriptionObj as string;

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
