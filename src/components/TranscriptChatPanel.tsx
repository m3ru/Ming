'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCedarStore, useRegisterState, useStateBasedMentionProvider, useSubscribeStateToAgentContext } from 'cedar-os';
import { ChatInput } from '@/cedar/components/chatInput/ChatInput';
import ChatBubbles from '@/cedar/components/chatMessages/ChatBubbles';
import { MessageSquare } from 'lucide-react';
import { feedbackReplyPrompt } from '@/lib/prompts';
import './TranscriptChatPanel.css';

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
    summary: `${feedbackReplyPrompt}`
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

  // Transform segments to extract only feedback from comment tags
  const mentionableFeedback = useMemo(() => {
    const feedbackItems: Array<{id: string, title: string, comment: string, feedback: string}> = [];
    
    segments.forEach((segment, segmentIndex) => {
      // Extract feedback from comment tags using regex
      const commentRegex = /<comment[^>]*feedback="([^"]*)"[^>]*>/g;
      let match;
      let commentIndex = 0;
      
      while ((match = commentRegex.exec(segment.content)) !== null) {
        const feedbackText = match[1];
        if (feedbackText && feedbackText.trim()) {
          feedbackItems.push({
            id: `feedback-${segmentIndex}-${commentIndex}`,
            title: feedbackText, // Show and insert only the feedback text
            comment: segment.title, // Original segment title for context
            feedback: feedbackText, // Clean feedback text
          });
          commentIndex++;
        }
      }
    });
    
    return feedbackItems;
  }, [segments]);

  // Register feedback items as state for mentioning
  useRegisterState({
    key: 'transcriptFeedback',
    description: 'Feedback items from annotated transcript for mentioning in chat',
    value: mentionableFeedback,
    setValue: () => {}, // Read-only
  });

  // Register mention provider for feedback items
  useStateBasedMentionProvider({
    stateKey: 'transcriptFeedback',
    trigger: '@',
    labelField: 'title', // Show and insert only the feedback text
    searchFields: ['feedback', 'comment'], // Search in feedback and comment
    description: 'Feedback',
    icon: (
      <MessageSquare className="w-4 h-4" />
    ),
    color: '#10b981',
    order: 1,
  });

  return (
    <div className="flex flex-col h-[500px] w-full bg-gray-50 border border-gray-200 rounded-lg">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-gray-200 bg-white rounded-t-lg flex-shrink-0">
        <MessageSquare className="w-5 h-5 mr-2 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-800">Ask About Your Performance</h3>
      </div>

      {/* Welcome Message 
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0">
        <div className="text-xs text-blue-700 space-y-1">
          <div>• "Why did I get a low empathy score?"</div>
          <div>• "How could I have handled that conflict better?"</div>
          <div>• "What did I do well in this conversation?"</div>
          <div>• Use <code className="bg-blue-200 px-1 rounded">#</code> to reference specific transcript segments</div>
        </div>
      </div>
      */}

      {/* Chat Messages Area - Fixed height with scroll */}
      <div className="flex-1 overflow-y-auto bg-white">
        <ChatBubbles />
      </div>

      {/* Chat Input */}
      <div className="flex-shrink-0 p-2 bg-white border-t border-gray-200 rounded-b-lg">
        <div className="w-full overflow-hidden">
          <ChatInput
            handleFocus={() => {}}
            handleBlur={() => {}}
            isInputFocused={false}
            stream={true}
            className="mention-input-wrapper"
          />
        </div>
      </div>
    </div>
  );
};

export default TranscriptChatPanel;