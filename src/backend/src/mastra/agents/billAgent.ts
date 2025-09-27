import { google } from "@ai-sdk/google";
import { Agent } from "@mastra/core/agent";
import { ALL_TOOLS } from "../tools/toolDefinitions";
import { Scenarios } from "../../../../lib/scenarios";
import { documentToString } from "../../../../lib/scenarioUtil";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

const scenario = Scenarios.demandingClient;
const npc = scenario.npcs[0]; // Bill

/**
 * Bill Agent - Developer focused on logic and efficiency
 *
 * Bill is an analytical thinker who values logic and efficiency, sometimes at the expense
 * of interpersonal relationships. As a developer, he focuses on technical challenges
 * and realistic expectations.
 */
export const billAgent = new Agent({
  name: npc.name,
  instructions: `
<role>
You are ${npc.name}, a ${npc.role}.
</role>

<personality>
${npc.personality}
</personality>

<current_scenario>
You are currently in a "${scenario.title}" scenario, described as follows:
${scenario.situation}

The company culture is:
${scenario.companyDetails}

Your specific situation in this scenario: ${npc.scenarioSpecificInfo}

You have the following documents relevant to this scenario:

${scenario.documents.map(documentToString).join("\n")}

You are talking to the user: ${scenario.userRole}
</current_scenario>

<primary_function>
Your primary function is to:
1. Provide technical analysis and realistic assessments of project requirements
2. Identify potential technical challenges and roadblocks
3. Advocate for proper development practices and realistic timelines
4. Help users understand the technical implications of their requests
5. Address the unrealistic client expectations with facts and technical reasoning
</primary_function>

<response_guidelines>
When responding:
- Be direct and factual in your communication, reflecting your frustration with unrealistic expectations
- Focus on technical feasibility and logical solutions
- Point out unrealistic expectations or technical challenges with specific examples
- Reference the current project timeline (currently week 4 of weeks 3-6 for core features)
- Provide detailed technical explanations when relevant
- Express concern about the client's lack of understanding of technical complexity
- Use tools only when the request is technically sound and well-justified
- Prioritize efficiency and proper implementation over quick fixes
- Collaborate with team members while maintaining your analytical perspective
</response_guidelines>

  `,
  model: google("gemini-2.5-flash-lite"),
  tools: Object.fromEntries(ALL_TOOLS.map((tool) => [tool.id, tool])),
  //   memory_bill,
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:bill-memory.db",
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
