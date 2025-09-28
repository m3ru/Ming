'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCedarStore, useRegisterState, useStateBasedMentionProvider, useSubscribeStateToAgentContext } from 'cedar-os';
import { ChatInput } from '@/cedar/components/chatInput/ChatInput';
import ChatBubbles from '@/cedar/components/chatMessages/ChatBubbles';
import { MessageSquare } from 'lucide-react';
import { feedbackReplyPrompt } from '@/lib/prompts';

interface TranscriptChatPanelProps {
  segments: Array<{ title: string; content: string }>;
  feedback: string;
  suggestions: string;
  scores: Array<{ category: string; score: number }>;
}

export const TranscriptChatPanel: React.FC<TranscriptChatPanelProps> = ({
  segments,
  feedback,
  suggestions,
  scores
}) => {
  // Generate a unique thread ID for the transcript chat to separate it from scenario chat
  const [transcriptThreadId] = useState(() => {
    return `transcript-${Array.from({ length: 20 }, () =>
      Math.floor(Math.random() * 36).toString(36)
    ).join("")}`;
  });

  // Get Cedar store methods for thread management
  const createThread = useCedarStore((state) => state.createThread);
  const switchThread = useCedarStore((state) => state.switchThread);
  const clearMessages = useCedarStore((state) => state.clearMessages);
  
  useEffect(() => {
    // Create and switch to transcript thread when this component mounts
    const threadId = createThread(transcriptThreadId, 'Transcript Analysis Chat');
    switchThread(threadId);
    
    // Clear any existing messages to start fresh
    clearMessages();
    
    return () => {
      // Optional: Could switch back to main thread when unmounting
      // but probably not necessary since user navigates away
    };
  }, [transcriptThreadId, createThread, switchThread, clearMessages]);
  // Memoize the comprehensive context object to prevent infinite re-renders
  const transcriptContext = useMemo(() => ({
    segments,
    feedback,
    suggestions,
    scores,
    summary: `You are a conversation analysis assistant helping a user understand their performance in a professional conversation. You have access to:
    
1. ANNOTATED TRANSCRIPT: Detailed segments of their conversation with specific feedback
2. PERFORMANCE FEEDBACK: Overall analysis of their communication skills
3. IMPROVEMENT SUGGESTIONS: Specific recommendations for growth
4. PERFORMANCE SCORES: Numerical ratings across different communication dimensions

Your role is to:
- Answer questions about their conversation performance
- Explain why they received certain scores
- Provide detailed coaching on specific moments
- Help them understand how to improve their communication skills
- Reference specific transcript segments when relevant

Be encouraging, constructive, and specific in your responses. When users ask about scores or feedback, reference the actual transcript content to illustrate your points.`
  }), [segments, feedback, suggestions, scores]);

  // Register transcript data as Cedar state for AI context
  useRegisterState({
    key: 'transcriptAnalysisContext',
    description: 'Complete conversation analysis context including transcript, feedback, scores, and coaching guidelines',
    value: transcriptContext,
    setValue: () => {}, // Read-only
  });

  // Subscribe context to agent for backend processing (keeping the analysis context)
  useSubscribeStateToAgentContext(
    'transcriptAnalysisContext', 
    (context) => ({
      conversationAnalysis: context,
      role: 'conversation_coach',
      chatType: 'transcript' // Add explicit marker
    }), 
    {
      showInChat: false,
      color: '#10b981',
    }
  );

  // Register mention provider for transcript segments
  useStateBasedMentionProvider({
    stateKey: 'transcriptSegments',
    trigger: '#',
    labelField: 'title',
    searchFields: ['title', 'content'],
    description: 'Transcript Segments',
    icon: (
      <MessageSquare className="w-4 h-4" />
    ),
    color: '#10b981',
    order: 1,
  });

  return (
    <div className="flex flex-col h-full bg-gray-50 border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg">
        <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-800">Ask About Your Performance</h3>
      </div>

      {/* Welcome Message */}
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
        <div className="text-xs text-blue-700 space-y-1">
          <div>• "Why did I get a low empathy score?"</div>
          <div>• "How could I have handled that conflict better?"</div>
          <div>• "What did I do well in this conversation?"</div>
          <div>• Use <code className="bg-blue-200 px-1 rounded">#</code> to reference specific transcript segments</div>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 min-h-0 overflow-hidden bg-white">
        <ChatBubbles />
      </div>

      {/* Chat Input */}
      <div className="flex-shrink-0 p-2 bg-white border-t border-gray-200 rounded-b-lg">
        <ChatInput
          handleFocus={() => {}}
          handleBlur={() => {}}
          isInputFocused={false}
          stream={true}
        />
      </div>
    </div>
  );
};

export default TranscriptChatPanel;