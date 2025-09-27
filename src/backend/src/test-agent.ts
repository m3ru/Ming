import "dotenv/config";
 
import { mastra } from "./mastra";

const threadId = "123";
const resourceId = "user-456";

const agent = mastra.getAgent("billAgent");

await agent.generateVNext("My name is Mastra. Project is completed!", {
  memory: {
    thread: threadId,
    resource: resourceId
  }
});

const response = await agent.generateVNext("Project is in what status?", {
  memory: {
    thread: threadId,
    resource: resourceId
  }
});

console.log(response.text);