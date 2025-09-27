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
- **Primary Agent**: `starterAgent` in `src/mastra/agents/starterAgent.ts`
  - Uses OpenAI GPT-4o-mini model
  - Configured with Cedar-OS frontend tools for UI manipulation
  - Has access to text manipulation tools (changeText, addNewTextLine)
  - Includes memory for conversation continuity

### Workflow Architecture
- **Chat Workflow**: `src/mastra/workflows/chatWorkflow.ts`
  - Handles agent invocation with streaming support via `streamVNext`
  - Processes text deltas and tool calls for real-time updates
  - Supports thread/resource-based memory contexts
  - Returns structured responses with usage metrics

### Tool Integration
- **Frontend Tools**: Defined in `src/mastra/tools/toolDefinitions.ts`
  - `changeTextTool`: Modifies main screen text via state setter
  - `addNewTextLineTool`: Adds styled text lines to UI
  - Uses Cedar-OS backend utilities for tool creation
  - Tools communicate with frontend via SSE JSON events

### Streaming Infrastructure
- **SSE Utilities**: `src/utils/streamUtils.ts`
  - Data-only SSE format for frontend compatibility
  - Handles text streaming with proper escaping
  - JSON event streaming for tool calls and responses

### Technology Stack
- **Runtime**: Node.js >=20.9.0, ES modules
- **Framework**: Mastra with TypeScript
- **Database**: LibSQL (SQLite-compatible)
- **AI Integration**: OpenAI via AI SDK
- **Frontend Integration**: Cedar-OS backend utilities

### Development Notes
- All TypeScript files use ES2022 target with bundler module resolution
- Memory system tracks last 5 messages by default
- Streaming uses Mastra's `streamVNext` for enhanced capabilities
- Tools are categorized in `TOOL_REGISTRY` for organized access
- Call Mastra mcp whenever you need information on using Mastra framework as Mastra framework iss relatively new