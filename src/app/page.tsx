'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  useRegisterState,
  useSubscribeStateToAgentContext,
} from 'cedar-os';

import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ScenarioCard from '@/components/ScenarioCard';
import MenuBar from '@/components/MenuBar';
import Parser from '@/app/report/parser';
import ScoreCard from '@/components/ScoreCard';
import AchievementsCard from '@/components/AchievementsCard';
import ProgressCard from '@/components/ProgressCard';
const defaultScores = [
  { category: "Empathy", score: 85 },
  { category: "Clarity", score: 90 },
  { category: "Open-mindedness", score: 80 },
  { category: "Assertiveness", score: 75 },
  { category: "Active Listening", score: 88 },
  { category: "Conflict Management", score: 99 },
];


export default function HomePage() {
  const router = useRouter();


  // Cedar main text
  const [mainText, setMainText] = React.useState('Budding Manager');

  // Scores from report data
  const [scores, setScores] = React.useState<{ category: string; score: number }[]>(defaultScores);


  // Load scores from localStorage
  React.useEffect(() => {
    const stored = localStorage.getItem('reportData');
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
  }, defaultScores);

  // Register Cedar state
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
        execute: (_current, setValue, args) => {
          setValue(args.newText);
        },
      },
    },
  });

  useSubscribeStateToAgentContext('mainText', (mainText) => ({ mainText }), {
    showInChat: true,
    color: '#4F46E5',
  });

  const renderContent = () => (
    <div className="relative h-screen w-full overflow-y-auto">
      <MenuBar />

      {/* Main Section */}
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 mb-4">Welcome back</h1>
          <h1 className="text-6xl font-bold text-blue-800 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 mb-8">
            Pass the first task to unlock new scenarios!
          </p>
        </div>

        {/* Scenarios */}
        <div className="flex space-x-4 w-full items-stretch">
          <ScenarioCard
            title="Performance Problems"
            imageUrl="/performanceReview.webp"
            description="An employee performance review meeting."
            color="#ffffff97"
            locked={false}
            role="Level: Intern"
          />
          <ScenarioCard
            title="Workplace Conflict"
            imageUrl="/workplaceConflict.jpg"
            description="A tense discussion between coworkers."
            color="#1f1c1897"
            locked={true}
            role="Level: Manager"
          />
          <ScenarioCard
            title="Employee Layoff"
            imageUrl="/employeeLayoff.jpg"
            description="A manager informing an employee about layoffs."
            color="#1f1c1897"
            locked={true}
            role="Level: CEO"
          />
        </div>
        <div id="analytics" className ="flex">
          {/* Scores */}
          <div className = "flex-2/5"> 
            <ScoreCard scores={scores} />
          </div>
            {/* Achievements */}
          <div className="w-full max-w-3xl">
            <AchievementsCard />
          </div>

          {/* Progress Tracker */}
          <div className="w-full max-w-3xl">
            <ProgressCard />
          </div>
        </div>
      </div>

    </div>
  );

  return renderContent();
}