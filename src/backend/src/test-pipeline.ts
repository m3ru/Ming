import "dotenv/config";
import { mastra } from "./mastra";
import { analysis } from "./lib/placeholder-data";

const run = await mastra.getWorkflow("scenarioPipelineWorkflow").createRunAsync();
const result = await run.start({
	inputData: {
		analysis: analysis,
	}
});
console.log("result", result);