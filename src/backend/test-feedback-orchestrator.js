// Quick test script for the feedback orchestrator
import { mastra } from './src/mastra/index.ts';

const sampleTranscript = `
user: Hey team, I think we really need to discuss the budget issues we're having with this project.

John: What specific issues are you seeing?

user: Well, we're already 20% over budget and we haven't even finished the first phase. I think we need to cut some features or find additional funding.

Sarah: That's a pretty serious accusation. Are you sure about those numbers?

user: I'm absolutely certain. I've been tracking this closely and the numbers don't lie.

John: Okay, let's look at this together. Can you show us the breakdown?

user: Sure, here's what I found... [shows spreadsheet] As you can see, we're spending way too much on external contractors.

Sarah: I see what you mean now. Maybe we should bring some of that work in-house.

user: Exactly! That's what I was thinking. We have the internal capability, we just need to reorganize our priorities.
`;

async function testFeedbackOrchestrator() {
  try {
    console.log('Testing feedback orchestrator workflow...');

    const result = await mastra.workflows.feedbackOrchestratorWorkflow.execute({
      transcript: sampleTranscript,
      additionalContext: {
        scenario: 'budget_discussion',
        participants: ['user', 'John', 'Sarah'],
        meetingType: 'project_review'
      }
    });

    console.log('=== FEEDBACK ORCHESTRATOR RESULTS ===');
    console.log('\n--- Segmented Analysis ---');
    console.log(result.segmentedAnalysis);

    console.log('\n--- Summary Analysis ---');
    console.log(result.summaryAnalysis);

    console.log('\n--- Detailed Feedback ---');
    console.log(result.detailedFeedback);

    console.log('\n--- Combined Report ---');
    console.log(result.combinedReport);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testFeedbackOrchestrator();