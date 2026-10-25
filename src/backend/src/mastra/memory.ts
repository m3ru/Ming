import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { databaseUrl } from "../lib/storage";

const storage = new LibSQLStore({
  url: databaseUrl("file:./storage.db"),
});

export const memory_bill = new Memory({
  options: {
    lastMessages: 30,
  },
});

export const memory = new Memory({
  options: {
    lastMessages: 5,
  },
  storage,
});

export { storage };
