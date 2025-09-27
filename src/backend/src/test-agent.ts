import "dotenv/config";
 
import { mastra } from "./mastra";

const agent = mastra.getAgent("helloWorldAgent");
const response = await agent.generateVNext("Who are you?");
 
console.log(response.text);