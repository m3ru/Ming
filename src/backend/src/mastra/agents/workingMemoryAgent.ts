import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { LibSQLStore } from "@mastra/libsql";
import { google } from "@ai-sdk/google";
 
export const workingMemoryAgent = new Agent({
  name: "working-memory-agent",
  instructions: "You are an AI agent with the ability to automatically recall memories from previous interactions.",
  model: google("gemini-2.5-flash-lite"),
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:working-memory.db"
    }),
    options: {
      workingMemory: {
        enabled: true
      },
      threads: {
        generateTitle: true
      }
    }
  })
});