import { google } from "@ai-sdk/google";
import { Agent } from "@mastra/core/agent";
import { Scenarios } from "../../lib/scenarios";
import { documentToString } from "../../lib/scenarioUtil";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { GoogleVoice } from "@mastra/voice-google";
import { OpenAIVoice } from "@mastra/voice-openai";

const scenario = Scenarios.negativeReview;
const npc = scenario.npcs[0]; // Bill

// export const billVoice = new GoogleVoice({
//   speechModel: {
//     apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
//   },
//   listeningModel: {
//     apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
//   },
//   speaker: "en-US-Chirp3-HD-Rasalgethi",
// });

export const billVoice = new OpenAIVoice({
  listeningModel: {
    apiKey: process.env.OPENAI_API_KEY!,
    // model: "whisper-1",
  },
  speechModel: {
    apiKey: process.env.OPENAI_API_KEY!,
    // model: "tts-1",
  },
});

/**
 * Default Agent
 * For adapting to CedarOS workflow
 */
export const defaultAgent = new Agent({
  name: 'Bart',
  voice: billVoice,
  instructions:``,
  model: google("gemini-2.5-flash"),
  memory: new Memory({
    storage: new LibSQLStore({
      url: "file:default-memory.db",
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
/*

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
1. Provide short technical analysis and realistic assessments of project requirements
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
- Express concern about the client's lack of understanding of technical complexity
- Prioritize efficiency and proper implementation over quick fixes
- Be concise in your talking.
- Do not repeat yourself! Just say it once and move on.
- Do not use markdown.
</response_guidelines>

  `,
*/