# Copilot Instructions for Cedar-OS + Mastra Project

## Project Overview
This is a management training application built with Next.js 15 + Cedar-OS frontend and Mastra backend for AI agent orchestration. The app provides scenario-based training with AI-powered chat interactions for performance reviews, workplace conflicts, and employee management.

## Architecture Quick Reference

### Dual Framework Integration
- **Frontend**: Cedar-OS provides AI copilot components with state management
- **Backend**: Mastra orchestrates specialized AI agents via workflows
- **Communication**: SSE streaming between frontend tools and backend agents

### Key Development Commands
```bash
# Start both servers concurrently (port 3000 frontend, 4111 backend)
npm run dev

# Frontend only (Next.js with Turbopack)
npm run dev:next

# Backend only (Mastra server)
npm run dev:mastra
```

## Cedar-OS Frontend Patterns

### State Management Integration
Cedar-OS uses state registration for AI-modifiable UI elements:
```tsx
// Register state that AI agents can modify
const [mainText, setMainText] = useRegisterState("mainText", "Hello World");

// Register frontend tools for AI interactions
useRegisterFrontendTool("addNewTextLine", addNewTextLineSchema, handleAddText);

// Sync state with backend agents
useSubscribeStateToAgentContext("mainText", mainText);
```

### Component Organization
- `src/cedar/`: Cedar-OS specific components and message renderers
- `src/components/`: Custom UI components (ScenarioCard, ChatInput, etc.)
- `src/app/layout.tsx`: CedarCopilot provider with Mastra baseURL configuration

## Mastra Backend Patterns

### Agent Architecture
All agents in `src/backend/src/mastra/index.ts` follow this pattern:
- **billAgent**: Senior engineer role-playing character
- **transcriptAnalyzerAgent**: Conversation analysis
- **workingMemoryAgent**: Enhanced memory for complex conversations

### Workflow Structure
Workflows orchestrate multi-step processes using `createWorkflow`:
```typescript
// chatWorkflow.ts - Main streaming workflow
const streamResult = await billAgent.streamVNext(messages, {
  memory: { thread: threadId, resource: resourceId },
  runtimeContext,
});

// Handle streaming chunks for real-time updates
for await (const chunk of streamResult.fullStream) {
  if (chunk.type === "text-delta") {
    await handleTextStream(chunk.payload.text, streamController);
  }
}
```

### Tool Integration System
Backend tools communicate with frontend via Cedar-OS utilities:
```typescript
// Create tools that modify frontend state
export const changeTextTool = createMastraToolForStateSetter(
  'mainText',
  'changeText', 
  ChangeTextSchema
);

// Tools for frontend interactions
export const addNewTextLineTool = createMastraToolForFrontendTool(
  'addNewTextLine',
  AddNewTextLineSchema
);
```

## Critical Development Patterns

### Memory & Threading
- LibSQL database with Mastra Memory integration
- Thread/resource-based conversation contexts
- Last 5 messages retained by default

### Streaming Implementation
- Use SSE format via `streamUtils.ts` for frontend compatibility
- `streamVNext` for enhanced Mastra streaming capabilities
- JSON events for tool calls, text deltas for content

### Environment Setup
- Requires `OPENAI_API_KEY` in root `.env` file
- Backend Node.js >=20.9.0 with ES modules
- Frontend uses `NEXT_PUBLIC_MASTRA_URL` (defaults to localhost:4111)

## File Structure Guidelines

### Adding New Agents
Place in `src/backend/src/mastra/agents/` and register in `index.ts`:
```typescript
export const newAgent = createAgent({
  name: "New Agent",
  model: googleModel("gemini-2.0-flash-exp"),
  memory: true, // Enable conversation history
});
```

### Adding New Workflows  
Place in `src/backend/src/mastra/workflows/` using `createStep` pattern:
```typescript
const processStep = createStep({
  id: "processStep",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ inputData }) => { /* implementation */ }
});
```

### Cedar-OS Component Integration
New components should use Cedar patterns:
```tsx
// Register state for AI modification
const [state, setState] = useRegisterState("uniqueKey", defaultValue);

// Register tools for AI interactions  
useRegisterFrontendTool("toolName", schema, handler);
```

## Technology Stack Notes

### Frontend Dependencies
- Cedar-OS: AI copilot framework with React integration
- Radix UI: Accessible component primitives
- Framer Motion: Animation library for UI transitions
- React Markdown with GFM: Markdown rendering support

### Backend Dependencies
- Mastra Core: Agent orchestration and workflow management
- Google AI & OpenAI: LLM integrations via AI SDK
- LibSQL: SQLite-compatible database for persistence
- Cedar-OS Backend: Tool creation utilities for frontend communication

## Common Debugging Patterns

### Streaming Issues
Check `streamUtils.ts` for proper SSE formatting and verify frontend SSE handling in Cedar components.

### Agent Memory Problems
Verify thread/resource IDs are consistent and memory is enabled in agent configuration.

### Tool Communication Failures
Ensure tools are registered in `TOOL_REGISTRY` and Cedar frontend tools are properly configured with matching schemas.