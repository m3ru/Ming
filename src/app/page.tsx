'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  useRegisterState,
  useRegisterFrontendTool,
  useSubscribeStateToAgentContext,
} from 'cedar-os';

import { ChatModeSelector } from '@/components/ChatModeSelector';
import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { DebuggerPanel } from '@/cedar/components/debugger';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ScenarioCard from '@/components/ScenarioCard';
import MenuBar from '@/components/MenuBar';

type ChatMode = 'floating' | 'sidepanel' | 'caption';

export default function HomePage() {
  const router = useRouter();
  
  // Cedar-OS chat components with mode selector
  // Choose between caption, floating, or side panel chat modes
  const [chatMode, setChatMode] = React.useState<ChatMode>('sidepanel');

  // Cedar state for the main text that can be changed by the agent
  const [mainText, setMainText] = React.useState('Budding Manager');

  // Cedar state for dynamically added text lines
  const [textLines, setTextLines] = React.useState<string[]>([]);

  // Register the main text as Cedar state with a state setter
  useRegisterState({
    key: 'mainText',
    description: 'The main text that can be modified by Cedar',
    value: mainText,
    setValue: setMainText,
    stateSetters: {
      changeText: {
        name: 'changeText',
        description: 'Change the main text to a new value',
        argsSchema: z.object({
          newText: z.string().min(1, 'Text cannot be empty').describe('The new text to display'),
        }),
        execute: (
          currentText: string,
          setValue: (newValue: string) => void,
          args: { newText: string },
        ) => {
          setValue(args.newText);
        },
      },
    },
  });

  // Subscribe the main text state to the backend
  useSubscribeStateToAgentContext('mainText', (mainText) => ({ mainText }), {
    showInChat: true,
    color: '#4F46E5',
  });

  // Register frontend tool for adding text lines
  {/* useRegisterFrontendTool({
    name: 'addNewTextLine',
    description: 'Add a new line of text to the screen via frontend tool',
    argsSchema: z.object({
      text: z.string().min(1, 'Text cannot be empty').describe('The text to add to the screen'),
      style: z
        .enum(['normal', 'bold', 'italic', 'highlight'])
        .optional()
        .describe('Text style to apply'),
    }),
    execute: async (args: { text: string; style?: 'normal' | 'bold' | 'italic' | 'highlight' }) => {
      const styledText =
        args.style === 'bold'
          ? `**${args.text}**`
          : args.style === 'italic'
            ? `*${args.text}*`
            : args.style === 'highlight'
              ? `🌟 ${args.text} 🌟`
              : args.text;
      setTextLines((prev) => [...prev, styledText]);
    },
  });
*/}
  const renderContent = () => (
    <div className="relative h-screen w-full">
      <MenuBar />
      {/* <ChatModeSelector currentMode={chatMode} onModeChange={setChatMode} /> */}

      {/* Main interactive content area */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 space-y-8">
        {/* Big text that Cedar can change */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">Welcome back</h1>
          <h1 className="text-6xl font-bold text-blue-800 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 mb-8">
            Pass the first task to unlock new scenarios!
          </p>
        </div>

        <div className="flex space-x-4 w-full items-stretch">
          <ScenarioCard
            title="Performance Problems"
            imageUrl="/performanceReview.webp"
            description="An employee performance review meeting."
            color="#ffffff97"
            locked={false}
          />
          <ScenarioCard
            title="Workplace Conflict"
            imageUrl="/workplaceConflict.jpg"
            description="A tense discussion between coworkers."
            color="#1f1c1897"
            locked={true}
          />
          
          
          <ScenarioCard
            title="Employee Layoff"
            imageUrl="/employeeLayoff.jpg"
            description="A manager informing an employee about layoffs."
            color="#1f1c1897"
            locked={true}
          />
        </div>

        {/* Reports button */}
        <div className="text-center">
          <Button
            onClick={() => router.push('/report')}
            size="lg"
            className="px-8 py-4 text-lg bg-blue-600 hover:bg-blue-700 font-semibold"
          >
            See analytics from past reports
          </Button>
        </div>
      </div>

      {chatMode === 'caption' && <CedarCaptionChat />}

      {chatMode === 'floating' && (
        <FloatingCedarChat side="right" title="Cedarling Chat" collapsedLabel="Chat with Cedar" />
      )}
    </div>
  );

  {/* if (chatMode === 'sidepanel') {
    return (
      <SidePanelCedarChat
        side="right"
        title="Cedarling Chat"
        collapsedLabel="Chat with Cedar"
        showCollapsedButton={true}
      >
        <DebuggerPanel />
        {renderContent()}
      </SidePanelCedarChat>
    );
  } 8*/}

  return renderContent();
}
