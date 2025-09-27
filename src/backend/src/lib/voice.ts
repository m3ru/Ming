import { Readable } from "node:stream";
import { billAgent } from "../mastra/agents/billAgent";
import {
  createReadStream,
  unlink,
  write,
  writeFile,
  writeFileSync,
} from "node:fs";
import { create } from "node:domain";

class AudioReadableStream extends Readable {
  private offset = 0;
  constructor(private buffer: ArrayBuffer) {
    super();
  }

  _read() {
    if (this.offset < this.buffer.byteLength) {
      const chunk = Buffer.from(
        this.buffer.slice(this.offset, this.offset + 1024)
      );
      this.push(chunk);
      this.offset += 1024;
    } else {
      this.push(null);
    }
  }
}

export async function handleVoiceRequest(audioBlob: Blob, context: string) {
  // 1. Transcribe audio

  const filePath = "./audioBlob.mp3";

  const buffer = Buffer.from(await audioBlob.arrayBuffer());
  console.log("Audio blob bytes:", buffer);

  writeFileSync(filePath, buffer);

  const stream = createReadStream(filePath);

  console.log("Converted audio blob to Node.js stream. Stream:", stream);
  const transcription = (await billAgent.voice.listen(stream)) as string;

  // unlink(filePath, (err) => {
  //   if (err) {
  //     console.error("Error deleting temporary audio file:", err);
  //   } else {
  //     console.log("Temporary audio file deleted.");
  //   }
  // });

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
