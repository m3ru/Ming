import "dotenv/config";
 
import { mastra } from "./mastra";
import { contextForAnalysis } from "./lib/scenarioUtil";
import { Scenarios } from "./lib/scenarios";
import { transcript } from "./lib/placeholder-data";

const run = await mastra.getWorkflow("feedbackOrchestratorWorkflow").createRunAsync();

const result = await run.start({
  inputData: {
    transcript: transcript,
    additionalContext: {
		scenario: `${contextForAnalysis(Scenarios.demandingClient)}`,
        participants: ['user', 'bart'],
        meetingType: 'project_review'
    },
  }
});

console.log("Segmented Analysis:");
// console.log(result.result.segmentedAnalysis);
console.log("Summary Analysis:");
// console.log(result.result.summaryAnalysis);
console.log("Detailed Analysis:");
// console.log(result.result.detailedFeedback);

// console.log(result);
 
// if (result.status === 'success') {
//   console.log(result.result.output);
// }
