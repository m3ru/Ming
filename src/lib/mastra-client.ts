import { MastraClient } from "@mastra/client-js";
 
export const mastraClient = new MastraClient({
  baseUrl: process.env.NEXT_PUBLIC_URL || "https://ming.m3ru.org" 
});