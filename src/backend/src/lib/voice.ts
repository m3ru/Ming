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
  // console.log("Transcription Object:", transcriptionObj);
  let transcription: string;

  try {
    // 1. Transcribe audio

    const arrayBuffer = await audioBlob.arrayBuffer();
    const stream = new AudioReadableStream(arrayBuffer);

    // console.log("Starting transcription... Stream:", stream);
    const transcriptionObj = await billAgent.voice.listen(stream, {
      fileType: "webm",
      language: "en-US",
      encoding: "LINEAR16",
    });

    transcription = transcriptionObj as string;
  } catch (error) {
    console.error("Error during transcription:", error);
    transcription = "Sorry, I couldn't understand the audio.";
  }

  // 2. Add context to the conversation
  const contextData = JSON.parse(context);
  const systemMessage = `Additional context: ${JSON.stringify(contextData)}`;

  // 3. Generate response with agent
  const response = await billAgent.generateVNext([
    { role: "system", content: systemMessage },
    { role: "user", content: transcription },
  ]);

  console.log("Agent response:", response.text);

  // 4. Convert to speech
  const speech = await billAgent.voice.speak(response.text);

  console.log(
    "Generated speech audio data readable:",
    typeof speech === "object" ? speech.readable : "void"
  );

  return {
    transcription: transcription,
    text: response.text,
    audioData: speech,
    audioFormat: "mp3",
  };
}
