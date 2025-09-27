"use client";

import ScenarioOverview from "@/components/ScenarioOverview";
import ScenarioVideo from "@/components/ScenarioVideo";
import { Scenarios } from "@/backend/src/lib/scenarios";
import SimpleChatPanel from "@/components/SimpleChatPanel";
import { SidePanelCedarChat } from "@/cedar/components/chatComponents/SidePanelCedarChat";
import { useState, useEffect } from "react";
import MenuBar from "@/components/MenuBar";

const scenario = Scenarios.demandingClient;

export default function ScenarioPage() {
  const [currentScenario, setCurrentScenario] = useState(scenario);
  const [scenarioCompleted, setScenarioCompleted] = useState(false);
  const [isLoadingNewScenario, setIsLoadingNewScenario] = useState(false);

  // Check if user has completed a scenario on component mount
  useEffect(() => {
    checkScenarioCompletion();
  }, []);

  // Monitor for scenario completion (when user returns from report page)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Page became visible - check if user just completed a scenario
        checkScenarioCompletion();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const checkScenarioCompletion = () => {
    // Check if there's report data (indicates completed scenario)
    const reportData = localStorage.getItem('reportData');
    const scenarioCompletedFlag = localStorage.getItem('scenarioCompleted');
    
    if (reportData && !scenarioCompleted && scenarioCompletedFlag === 'true') {
      console.log('User has completed a scenario, generating new prompt...');
      setScenarioCompleted(true);
      generateNewScenarioPrompt();
    }
  };

  const generateNewScenarioPrompt = async () => {
    setIsLoadingNewScenario(true);
    try {
      // For now, we'll generate a mock prompt - replace this with actual backend call
      const newPrompt = await generateMockScenarioPrompt();
      
      console.log('New scenario prompt generated:');
      console.log('=================================');
      console.log(newPrompt);
      console.log('=================================');
      
      // Clear the completion flag so we don't keep regenerating
      localStorage.removeItem('scenarioCompleted');
      
      // TODO: In the future, this is where you'd:
      // 1. Parse the prompt to create a new Scenario object
      // 2. setCurrentScenario(newScenarioObject)
      // 3. Update the scenario in your backend/state management
      
    } catch (error) {
      console.error('Failed to generate new scenario prompt:', error);
    } finally {
      setIsLoadingNewScenario(false);
    }
  };

  // Mock function to simulate backend scenario generation
  const generateMockScenarioPrompt = async (): Promise<string> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // This would be replaced with actual backend call
    return `
SCENARIO PROMPT:

Title: "Handling Team Conflict During Sprint Planning"

Situation: You are a Scrum Master at a growing tech startup. During today's sprint planning meeting, two senior developers (Sarah and Mike) are having a heated disagreement about the technical approach for a critical feature. Sarah advocates for a quick implementation using existing libraries, while Mike insists on building a custom solution for better performance. The rest of the team is watching tensely, and the Product Owner is getting impatient as the meeting runs over time.

Company Culture: The company values innovation, collaboration, and psychological safety. There's an emphasis on data-driven decisions and open communication, but also pressure to deliver features quickly to meet investor milestones.

Your Role: As Scrum Master, you need to facilitate a resolution that maintains team harmony while ensuring the project moves forward efficiently.

NPCs:
- Sarah Chen (Senior Frontend Developer): Pragmatic, deadline-focused, values proven solutions
- Mike Rodriguez (Senior Backend Developer): Performance-oriented, prefers custom solutions, detail-focused
- Alex Kim (Product Owner): Results-driven, business-focused, concerned about timeline

Key Challenges:
1. Mediate between conflicting technical opinions
2. Keep the meeting productive and on-track
3. Maintain team psychological safety
4. Balance technical excellence with business needs
5. Use Scrum principles to guide decision-making

Success Criteria:
- Reach a technical decision both developers can support
- Maintain positive team relationships
- Keep project timeline realistic
- Demonstrate effective Scrum Master facilitation skills
    `.trim();
  };
  return (
    <div>
      <MenuBar />
    <div className="w-screen flex" style={{ height: 'calc(100vh - 3rem)' }}>
      <ScenarioOverview scenario={currentScenario} />
      <div className="flex-grow flex flex-col">
        {isLoadingNewScenario && (
          <div className="w-full p-3 text-center bg-blue-100 border-b">
            <p className="text-blue-800 font-medium">
              🔄 Generating new scenario based on your performance...
            </p>
          </div>
        )}
        {/*<div className="w-full p-2 text-center bg-white">
          <h1 className="text-2xl font-bold">Scenario: {scenario.title}</h1>
          <p>{scenario.goal}</p>
        </div> */}
        <ScenarioVideo scenario={currentScenario} />
      </div>
      <div className="w-[350px] flex flex-col items-end">
        <div className="p-4 bg-white rounded shadow w-full" style={{ height: 'calc(100vh - 3rem)' }}>
          {/* <SimpleChatPanel /> */}
          <SidePanelCedarChat documents={currentScenario.documents} />
        </div>
      </div>
    </div>
        </div>

  );
}
