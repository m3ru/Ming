import { MastraClient } from "@mastra/client-js";
 
export const mastraClient = new MastraClient({
  baseUrl: process.env.NEXT_PUBLIC_URL || "http://3.220.169.218:4111" 
});