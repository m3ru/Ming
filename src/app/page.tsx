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
import Parser from '@/app/report/parser';
import { ChevronUp, ChevronDown } from 'lucide-react';

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

  // State for scores from report data
  const [scores, setScores] = React.useState<{ category: string; score: number }[]>([]);

  // Load scores from localStorage (same as report page)
  React.useEffect(() => {
    const stored = localStorage.getItem("reportData");
    if (stored) {
      try {
        const data = Parser(stored);
        if (data.scores) {
          setScores(data.scores);
        }
      } catch (error) {
        console.log('Could not parse report data:', error);
      }
    }
  }, []);

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
            role="Intern"
          />
          <ScenarioCard
            title="Workplace Conflict"
            imageUrl="/workplaceConflict.jpg"
            description="A tense discussion between coworkers."
            color="#1f1c1897"
            locked={true}
            role="Manager"
          />
          
          
          <ScenarioCard
            title="Employee Layoff"
            imageUrl="/employeeLayoff.jpg"
            description="A manager informing an employee about layoffs."
            color="#1f1c1897"
            locked={true}
            role="CEO"
          />
        </div>

        {/* Scores display */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-8 py-4 text-lg font-semibold bg-gray-100 border border-gray-200">
            {scores.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-base font-bold">Latest Scores</div>
                  <Button
                    onClick={() => router.push('/report')}
                    size="sm"
                    className="text-xs bg-blue-600 hover:bg-blue-700"
                  >
                    View Full Report
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                  {scores.slice(0, 6).map((score, index) => (
                    <div key={index} className="flex items-center min-w-[100px]">
                      <span className="text-gray-700">{score.category}:</span>
                      <span className="font-bold text-blue-600 ml-1">{score.score}</span>
                      {score.score > 50 ? (
                        <ChevronUp className="h-3 w-3 text-green-500 ml-1" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-red-500 ml-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <span className="text-gray-500">No scores available</span>
            )}
          </div>
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
