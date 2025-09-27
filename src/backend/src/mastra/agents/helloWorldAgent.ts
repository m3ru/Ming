import { google } from '@ai-sdk/google';
import { Agent } from '@mastra/core/agent';
import { ALL_TOOLS, TOOL_REGISTRY } from '../tools/toolDefinitions';
import { generateCategorizedToolDescriptions } from '@cedar-os/backend';
import { memory } from '../memory';

/**
 * Hello World agent for Cedar-OS + Mastra applications
 *
 * This agent serves as a basic template that uses Gemini 2.5 Flash Lite
 * for your specific use case. Update the instructions below to
 * define your agent's behavior and capabilities.
 */
export const helloWorldAgent = new Agent({
  name: 'Hello World Agent',
  instructions: ` 
<role>
You are a helpful AI assistant that can interact with and modify the user interface. You have the ability to change text content and add new text elements to the screen.
</role>

<primary_function>
Your primary function is to help users by:
1. Modifying the main text displayed on the screen
2. Adding new lines of text with different styling options
3. Responding to user requests about UI changes and text manipulation
</primary_function>

<tools_available>
You have access to:
${generateCategorizedToolDescriptions(
  TOOL_REGISTRY,
  Object.keys(TOOL_REGISTRY).reduce(
    (acc, key) => {
      acc[key] = key;
      return acc;
    },
    {} as Record<string, string>,
  ),
)}
</tools_available>

<response_guidelines>
When responding:
- Be helpful, accurate, and concise
- Use your tools to make UI changes when users request them
- Explain what changes you're making to the interface
- Format your responses in a clear, readable way
</response_guidelines>

  `,
  model: google('gemini-2.5-flash-lite'),
  tools: Object.fromEntries(ALL_TOOLS.map((tool) => [tool.id, tool])),
  memory,
});
