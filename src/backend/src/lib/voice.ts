import { Readable } from "node:stream";
import { billAgent } from "../mastra/agents/billAgent";
import { createWriteStream } from "node:fs";

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

function saveAudioToFile(audioData: Readable, filename: string) {
  const writeStream = createWriteStream(filename);
  audioData.pipe(writeStream);
  writeStream.on("finish", () => {
    console.log(`Audio file saved as ${filename}`);
  });
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function streamToArrayBuffer(stream: Readable): Promise<ArrayBuffer> {
  const buffer = await streamToBuffer(stream);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
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

  // 4. Convert to speech
  const speech = await billAgent.voice.speak(response.text);

  const stream = speech as Readable;

  // Write stream to file
  // saveAudioToFile(stream, "./output.mp3");

  return {
    transcription: transcription,
    text: response.text,
    audioData: (await streamToBuffer(stream)).toString("base64"),
    audioFormat: "mp3",
  };
}
