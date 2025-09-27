import { Readable } from "node:stream";
import { billAgent, billVoice } from "../mastra/agents/billAgent";
import { createWriteStream } from "node:fs";
import { StorageThreadType } from "@mastra/core";

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

export async function handleVoiceRequest(
  audioBlob: Blob,
  context: string,
  {
    threadId,
    resourceId,
  }: {
    threadId: string | (Partial<StorageThreadType> & { id: string });
    resourceId: string;
  }
) {
  const transcription = await speechToText(audioBlob);

  // 2. Add context to the conversation
  const contextData = JSON.parse(context);
  const systemMessage = `Additional context: ${JSON.stringify(contextData)}`;

  // 3. Generate response with agent
  const response = await billAgent.generateVNext(
    [
      { role: "system", content: systemMessage },
      { role: "user", content: transcription },
    ],
    {
      memory: {
        thread: threadId,
        resource: resourceId,
      },
    }
  );

  // 4. Convert response to speech
  const speech = await textToSpeech(response.text);

  return {
    transcription: transcription,
    text: response.text,
    audioData: speech.audioData,
    audioFormat: "mp3",
  };
}

export async function speechToText(audioBlob: Blob) {
  // console.log("Transcription Object:", transcriptionObj);
  let transcription: string;

  try {
    // 1. Transcribe audio

    const arrayBuffer = Buffer.from(await audioBlob.arrayBuffer());

    // console.log("Starting transcription... Stream:", stream);
    const transcriptionObj = await billVoice.listen(Readable.from(arrayBuffer));

    return transcriptionObj as string;
  } catch (error) {
    console.error("Error during transcription:", error);
    return "Hi Bill!";
  }
}

export async function textToSpeech(text: string) {
  // 1. Convert to speech
  const speech = await billAgent.voice.speak(text, {
    speed: 1.3,
  });

  const stream = speech as Readable;

  // Write stream to file
  // saveAudioToFile(stream, "./output.mp3");

  return {
    audioData: (await streamToBuffer(stream)).toString("base64"),
    audioFormat: "mp3",
  };
}
