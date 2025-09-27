# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend (Next.js)
- **Development**: `npm run dev` - Starts both frontend and backend concurrently
- **Frontend only**: `npm run dev:next` - Next.js with Turbopack
- **Backend only**: `npm run dev:mastra` - Mastra backend server
- **Build**: `npm run build` - Production build
- **Lint**: `npm run lint` - ESLint checking
- **Format**: `npm run pretty` - Prettier code formatting
- **Start**: `npm run start` - Production server

### Backend (Mastra)
- **Development**: `npm run dev` (from src/backend) - Mastra development server
- **Build**: `npm run build` - Build Mastra application
- **Start**: `npm run start` - Production Mastra server

## Architecture Overview

This is a Cedar-OS + Mastra application for management training scenarios with AI-powered chat interactions. The project combines a Next.js frontend with Cedar-OS components and a Mastra backend for AI agent orchestration.

### Frontend Architecture (Next.js + Cedar-OS)

**Key Framework Integration:**
- **Cedar-OS**: AI copilot framework providing chat UI components and state management
- **Next.js 15**: React framework with Turbopack for development
- **Tailwind CSS**: Styling with custom animations
- **TypeScript**: Full type safety throughout

**Core Component Structure:**
- **`src/app/layout.tsx`**: Root layout with CedarCopilot provider configuration
- **`src/app/page.tsx`**: Main dashboard with scenario cards, score display, and Cedar state management
- **`src/cedar/`**: Cedar-OS specific components and message renderers
- **`src/components/`**: Custom UI components for scenarios, chat modes, and scoring

**Cedar-OS Integration Patterns:**
- State registration with `useRegisterState()` for AI-modifiable content
- Frontend tools via `useRegisterFrontendTool()` for AI interactions
- State subscription with `useSubscribeStateToAgentContext()` for backend sync
- Multiple chat modes: floating, sidepanel, and caption

### Backend Architecture (Mastra)

**Core Framework:**
- **Mastra**: AI agent orchestration framework with workflow management
- **LibSQL**: SQLite-compatible database for persistence
- **Memory System**: Conversation history and context management
- **Streaming**: Server-sent events for real-time AI responses

**Agent System:**
Multiple specialized agents in `src/backend/src/mastra/index.ts`:
- **helloWorldAgent**: Basic interaction testing
- **billAgent**: Senior engineer role-playing character
- **workingMemoryAgent**: Enhanced memory for complex conversations
- **transcriptAnalyzerAgent**: Conversation transcript analysis
- **transcriptDetailAgent**: Detailed transcript segment analysis
- **transcriptSummaryAnalyzerAgent**: Summary generation

**Workflow Architecture:**
- **Chat Workflow**: `src/backend/src/mastra/workflows/chatWorkflow.ts` - Handles streaming agent invocation
- **Feedback Orchestrator**: `src/backend/src/mastra/workflows/feedbackOrchestratorWorkflow.ts` - Orchestrates feedback processing

**Tool Integration:**
- **Frontend Tools**: `src/backend/src/mastra/tools/toolDefinitions.ts` for UI manipulation
- **Mastra Docs Tool**: MCP integration for framework documentation access
- **Cedar-OS Backend**: Tool creation utilities for frontend communication

### Application Flow

**Scenario-Based Training:**
1. **Dashboard**: Performance scenario cards with lock/unlock progression
2. **Scenario Pages**: Interactive training scenarios (performance reviews, workplace conflicts)
3. **Report System**: Score tracking and analysis with localStorage persistence
4. **AI Integration**: Cedar chat for guidance and feedback throughout scenarios

**Data Flow:**
- Frontend state changes trigger Cedar-OS state updates
- Backend agents process requests via Mastra workflows
- Streaming responses update UI in real-time via SSE
- Memory system maintains conversation context across interactions
- Report data persists locally and displays on dashboard

### Key Technologies

**Frontend Stack:**
- Next.js 15 with React 19, TypeScript 5
- Cedar-OS for AI copilot functionality
- Radix UI components with Tailwind CSS
- Framer Motion for animations
- React Markdown with GFM support

**Backend Stack:**
- Mastra framework with Node.js 20+
- Google AI and OpenAI integration
- LibSQL database with memory capabilities
- Voice integration (Google Voice, OpenAI Voice)
- MCP (Model Context Protocol) for documentation access

### Development Notes

**Environment Setup:**
- Requires `OPENAI_API_KEY` in `.env` file
- Backend runs on port 4111, frontend on port 3000
- Concurrent development with both servers via `npm run dev`

**Cedar-OS Patterns:**
- Use `useRegisterState()` for AI-modifiable UI elements
- State setters enable AI to trigger UI changes
- Frontend tools allow AI to perform client-side actions
- Multiple chat modes support different interaction styles

**Mastra Patterns:**
- Agent-based architecture for specialized AI interactions
- Workflow orchestration for complex multi-step processes
- Memory integration for conversation continuity
- Streaming capabilities for real-time user feedback
- Tool registry for organized capability management

**File Organization:**
- `src/app/`: Next.js pages and routing
- `src/cedar/`: Cedar-OS components and configuration
- `src/components/`: Reusable UI components
- `src/lib/`: Utilities and client configurations
- `src/backend/src/mastra/`: Mastra agents, workflows, and tools
- `src/backend/src/lib/`: Backend utilities and data structures