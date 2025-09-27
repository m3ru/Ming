import React from 'react';
import { createMessageRenderer, CustomMessage } from 'cedar-os';
import { ShimmerText } from './components/text/ShimmerText';

// Define custom message types for tool events
type ToolCallMessage = CustomMessage<
  'tool-call',
  {
    payload?: {
      toolName?: string;
      args?: unknown;
    };
  }
>;

type ToolResultMessage = CustomMessage<
  'tool-result',
  {
    payload?: {
      toolName?: string;
      result?: unknown;
      error?: string;
    };
  }
>;

// Tool Call Renderer - Hidden from UI but still processes in background
export const ToolCallRenderer = createMessageRenderer<ToolCallMessage>({
  type: 'tool-call',
  namespace: 'agent-tools',
  render: (message) => {
    // Return null to hide from UI while tool still executes in background
    return null;
  },
  validateMessage: (msg): msg is ToolCallMessage => {
    return msg.type === 'tool-call';
  },
});

// Tool Result Renderer - Hidden from UI but still processes in background
export const ToolResultRenderer = createMessageRenderer<ToolResultMessage>({
  type: 'tool-result',
  namespace: 'agent-tools',
  render: (message) => {
    // Return null to hide from UI while tool result is still captured
    return null;
  },
  validateMessage: (msg): msg is ToolResultMessage => {
    return msg.type === 'tool-result';
  },
});

// Export all renderers for easy registration
export const messageRenderers = [ToolCallRenderer, ToolResultRenderer];
