import { Memory } from "@mastra/memory";
import { Agent } from "@mastra/core/agent";
import { LibSQLStore } from "@mastra/libsql";
import { textModel } from "../models";
import { databaseUrl } from "../../lib/storage";

export const workingMemoryAgent = new Agent({
  name: "working-memory-agent",
  instructions:
    "You are an AI agent with the ability to automatically recall memories from previous interactions.",
  model: textModel,
  memory: new Memory({
    storage: new LibSQLStore({
      url: databaseUrl("file:working-memory.db"),
    }),
    options: {
      workingMemory: {
        enabled: true,
      },
      threads: {
        generateTitle: true,
      },
    },
  }),
});
