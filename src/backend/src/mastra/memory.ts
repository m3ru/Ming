import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

const storage = new LibSQLStore({
  url: 'file:./storage.db', // Local SQLite database file
});


export const memory_bill = new Memory({
//   storage: new LibSQLStore({
// 	url: 'file:./bill_memory.db', // Separate database for Bill Agent memory
//   }),
  options: {
	lastMessages: 30,
  }
});

export const memory = new Memory({
  options: {
    lastMessages: 5,
  },
  storage,
});

export { storage };
