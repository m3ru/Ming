# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development server**: `npm run dev` - Starts Mastra development server with hot reload
- **Build**: `npm run build` - Builds the Mastra application for production
- **Start**: `npm run start` - Starts the built application in production mode

## Architecture Overview

This is a Mastra-based backend application for a Cedar-OS integration project. The architecture follows Mastra's patterns with these key components:

### Core Structure
- **Entry Point**: `src/mastra/index.ts` - Main Mastra configuration with agents, workflows, and storage
- **Storage**: LibSQL database (`storage.db`) with Mastra Memory integration for conversation history
- **API Routes**: SSE streaming endpoints at `/chat/stream` for real-time agent interactions

### Agent System
Multiple specialized agents configured in `src/mastra/index.ts`:
- **helloWorldAgent**: Basic agent for testing and simple interactions
- **billAgent**: Role-playing agent representing a senior engineer character
- **workingMemoryAgent**: Agent with enhanced memory capabilities for complex conversations
- **transcriptAnalyzerAgent**: Analyzes conversation transcripts
- **transcriptDetailAgent**: Provides detailed analysis of specific transcript segments
- **transcriptSummaryAnalyzerAgent**: Generates summaries of transcript analysis
- All agents use Google AI models and include memory for conversation continuity

### Workflow Architecture
- **Chat Workflow**: `src/mastra/workflows/chatWorkflow.ts`
  - Handles agent invocation with streaming support via `streamVNext`
  - Processes text deltas and tool calls for real-time updates
  - Supports thread/resource-based memory contexts
  - Returns structured responses with usage metrics
- **Feedback Orchestrator Workflow**: `src/mastra/workflows/feedbackOrchestratorWorkflow.ts`
  - Orchestrates feedback processing and analysis workflows
  - Integrates with transcript analysis agents for comprehensive evaluation

### Tool Integration
- **Frontend Tools**: Defined in `src/mastra/tools/toolDefinitions.ts`
  - `changeTextTool`: Modifies main screen text via state setter
  - `addNewTextLineTool`: Adds styled text lines to UI
  - Uses Cedar-OS backend utilities for tool creation
  - Tools communicate with frontend via SSE JSON events
- **Mastra Docs Search Tool**: `src/mastra/tools/mastraDocsSearchTool.ts`
  - Provides access to Mastra framework documentation via MCP
  - Essential for getting up-to-date information about Mastra features

### Streaming Infrastructure
- **SSE Utilities**: `src/utils/streamUtils.ts`
  - Data-only SSE format for frontend compatibility
  - Handles text streaming with proper escaping
  - JSON event streaming for tool calls and responses

### Technology Stack
- **Runtime**: Node.js >=20.9.0, ES modules
- **Framework**: Mastra with TypeScript
- **Database**: LibSQL (SQLite-compatible) via `@mastra/libsql`
- **AI Integration**: Google AI via `@ai-sdk/google`, OpenAI via `@ai-sdk/openai`
- **Frontend Integration**: Cedar-OS backend utilities
- **Voice Integration**: Google Voice and OpenAI Voice packages for audio capabilities
- **Observability**: Built-in telemetry and observability enabled

### Development Notes
- All TypeScript files use ES2022 target with bundler module resolution
- Memory system tracks last 5 messages by default
- Streaming uses Mastra's `streamVNext` for enhanced capabilities
- Tools are categorized in `TOOL_REGISTRY` for organized access
- Multiple agent architecture allows for specialized conversation handling
- Transcript analysis system for conversation evaluation and feedback
- Call Mastra MCP whenever you need information on using Mastra framework as Mastra framework is relatively new

### Key Directories
- `src/mastra/agents/`: Individual agent implementations for different conversation types
- `src/mastra/workflows/`: Workflow orchestrations for complex multi-step processes
- `src/mastra/tools/`: Tool definitions and integrations
- `src/lib/`: Utility functions, types, and data structures
- `src/utils/`: Infrastructure utilities like streaming and formatting