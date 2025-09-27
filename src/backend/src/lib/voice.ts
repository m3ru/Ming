import { Readable } from "node:stream";
import { billAgent, billVoice } from "../mastra/agents/billAgent";
import { createWriteStream } from "node:fs";
import { StorageThreadType } from "@mastra/core";
import { Context } from "node:vm";
import { chatWorkflow } from "../mastra/workflows/chatWorkflow";
import {
  createSSEStream,
  streamAudioFromText,
  streamJSONEvent,
} from "../utils/streamUtils";

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

/**
 * Create workflow input data from the voice streaming parameters
 */
function createWorkflowInput(
  baseInput: {
    prompt: string;
    additionalContext?: unknown;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    resourceId?: string;
    threadId?: string;
  },
  controller: ReadableStreamDefaultController<Uint8Array>,
  isStreaming: boolean = true,
  isVoice: boolean = true
) {
  return {
    ...baseInput,
    streamController: isStreaming ? controller : undefined,
    isVoice,
  };
}

/**
 * Handle voice streaming request
 * Transcribes audio, then streams the LLM response back
 */
export async function handleVoiceStream(c: Context) {
  try {
    const form = await c.req.formData();
    console.log("Received form data:", form);
    const audioFile = form.get("audio") as File;
    const additionalContext = form.get("context") as string | null;
    const settings = form.get("settings") as string | null;
    const resourceId = form.get("resourceId") as string | null;
    const threadId = form.get("threadId") as string | null;

    let parsedAdditionalContext: unknown = undefined;
    let parsedSettings: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      resourceId?: string;
      threadId?: string;
    } = {
      resourceId: resourceId ?? undefined,
      threadId: threadId ?? undefined,
    };

    // Parse additional context if provided
    if (additionalContext) {
      try {
        parsedAdditionalContext = JSON.parse(additionalContext);
      } catch {
        // leave undefined if not valid JSON
      }
    }

    // Parse voice settings if provided
    if (settings) {
      try {
        parsedSettings = {
          ...JSON.parse(settings),
          resourceId: resourceId ?? undefined,
          threadId: threadId ?? undefined,
        };
      } catch {
        // use empty object if not valid JSON
      }
    }

    if (!audioFile) {
      return c.json({ error: "audio required" }, 400);
    }

    // Convert audio file to buffer and then to stream
    const buf = Buffer.from(await audioFile.arrayBuffer());

    // Transcribe the audio
    const transcription = await billAgent.voice.listen(Readable.from(buf), {
      filetype: "webm",
    });

    // Create SSE stream for real-time response
    return createSSEStream(async (controller) => {
      // Emit the transcription in the format that Cedar OS voice streaming expects
      console.log("Emitting voice transcription:", transcription);
      streamJSONEvent(controller, "transcription", {
        type: "transcription",
        transcription: transcription,
      });

      // Start the chat workflow with the transcription
      const run = await chatWorkflow.createRunAsync();

      if (typeof transcription !== "string") {
        console.error("Transcription failed, not a string:", transcription);
      }

      const result = await run.start({
        inputData: createWorkflowInput(
          {
            prompt: transcription as string,
            additionalContext: parsedAdditionalContext ?? additionalContext,
            temperature: parsedSettings.temperature,
            maxTokens: parsedSettings.maxTokens,
            systemPrompt: parsedSettings.systemPrompt,
            resourceId: parsedSettings.resourceId,
            threadId: parsedSettings.threadId,
          },
          controller,
          true,
          true
        ),
      });

      if (result.status !== "success") {
        console.error("Workflow failed:", result.status);
        streamJSONEvent(controller, "error", {
          type: "error",
          error: `Workflow failed: ${result.status}`,
        });
      }

      // Emit completion event
      console.log("Voice stream completed successfully");
      streamJSONEvent(controller, "done", {
        type: "done",
        completedItems: [],
      });

      // The workflow handles streaming the response through the controller
      // No need to manually close here as the workflow will handle completion
    });
  } catch (error) {
    console.error("Voice stream error:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      500
    );
  }
}

export function createSpeakFunction() {
  return (t: string, options?: Record<string, unknown>) =>
    billAgent.voice.speak(
      t,
      options as { speaker?: string; speed?: number }
    ) as unknown as Promise<ReadableStream>;
}

export async function handleVoiceOutput(
  streamController: ReadableStreamDefaultController<Uint8Array>,
  pendingText: string,
  options: { voice?: string; speed?: number; eventType?: string } = {}
) {
  if (!pendingText) return;

  const speakFn = createSpeakFunction();
  await streamAudioFromText(streamController, speakFn, pendingText, {
    voice: "alloy",
    speed: 1.0,
    eventType: "audio",
    ...options,
  });
}
