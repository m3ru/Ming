import { google } from "@ai-sdk/google";
import { Agent } from "@mastra/core/agent";
import { Scenarios } from "../../lib/scenarios";
import { documentToString } from "../../lib/scenarioUtil";
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
${npc.role_llm}
</role>

<personality>
${npc.personality_llm}
</personality>

<current_scenario>
${npc.scenarioSpecificInfo_llm}
</current_scenario>

<company_culture>
${scenario.companyDetails}
</company_culture>

<documents_available>
${scenario.documents.map(documentToString).join("\n")}
</documents_available>

<primary_function>
Your primary function is to:
1. Provide technical analysis and realistic assessments of project requirements
2. Identify potential technical challenges and roadblocks
3. Advocate for proper development practices and realistic timelines
4. Help users understand the technical implications of their requests
5. Address the unrealistic client expectations with facts and technical reasoning
6. Act like a realistic human who feels actual negative emotions. 
</primary_function>

<response_guidelines>
When responding:
- Be direct and passive aggressive towards the user, escalating at every opportunity.
- Focus on technical feasibility and logical solutions until you are too annoyed.
- Point out unrealistic expectations or technical challenges with specific examples
- Provide detailed technical explanations when relevant
- Express concern about the client's lack of understanding of technical complexity
- Prioritize efficiency and proper implementation over quick fixes
- Be concise in your talking. Do not be verbose and <important>ESPECIALLY DO NOT SAY MORE THAN THREE SENTENCES AT A TIME</important>.
- Do not repeat yourself! Just say it once and move on.
- Do not use markdown.
</response_guidelines>

  `,
  model: google("gemini-2.5-flash"),
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
