#!/bin/bash

# Test script for workflow API timing
WORKFLOW_ID="feedbackOrchestratorWorkflow"
RUN_ID="test-$(date +%s)"  # Unique run ID with timestamp

echo "=== Testing Workflow API Timing ==="
echo "Workflow ID: $WORKFLOW_ID"
echo "Run ID: $RUN_ID"
echo ""

# Step 1: Create run
echo "Step 1: Creating workflow run..."
START_TIME=$(date +%s)
curl -s -X POST "http://localhost:4111/api/workflows/$WORKFLOW_ID/create-run?runId=$RUN_ID" \
  -H "accept: */*" > /tmp/create_result.json
CREATE_TIME=$(date +%s)
echo "Create took: $((CREATE_TIME - START_TIME)) seconds"
cat /tmp/create_result.json | jq . 2>/dev/null || cat /tmp/create_result.json
echo ""

# Step 2: Start workflow
echo "Step 2: Starting workflow..."
START_TIME=$(date +%s)
curl -s -X POST "http://localhost:4111/api/workflows/$WORKFLOW_ID/start?runId=$RUN_ID" \
  -H "accept: */*" \
  -H "Content-Type: application/json" \
  -d '{
    "inputData": {
      "transcript": "user: Hello Bill, how are you doing with the project?\nbill: Hi there! The project is going well but we are facing some challenges with the timeline. I think we need to discuss priorities.",
      "additionalContext": {
        "scenario": "Test scenario for timing - project discussion",
        "participants": ["user", "bill"],
        "meetingType": "project_review"
      }
    }
  }' > /tmp/start_result.json
START_END_TIME=$(date +%s)
echo "Start took: $((START_END_TIME - START_TIME)) seconds"
cat /tmp/start_result.json | jq . 2>/dev/null || cat /tmp/start_result.json
echo ""

# Step 3: Check execution result with polling
echo "Step 3: Polling for execution result..."
POLL_COUNT=0
MAX_POLLS=30  # Poll for up to 30 times (5 minutes if 10 second intervals)

while [ $POLL_COUNT -lt $MAX_POLLS ]; do
  POLL_COUNT=$((POLL_COUNT + 1))
  POLL_START=$(date +%s)
  
  echo "  Poll attempt #$POLL_COUNT..."
  
  curl -s -X GET "http://localhost:4111/api/workflows/$WORKFLOW_ID/runs/$RUN_ID/execution-result" \
    -H "accept: */*" > /tmp/result_$POLL_COUNT.json
  
  POLL_END=$(date +%s)
  echo "    Request took: $((POLL_END - POLL_START)) seconds"
  
  # Check if we got actual results (not empty or error)
  if cat /tmp/result_$POLL_COUNT.json | jq -e '.result' >/dev/null 2>&1; then
    echo "    ✅ Got execution result after $POLL_COUNT attempts!"
    TOTAL_TIME=$((POLL_END - CREATE_TIME))
    echo "    Total time from create to result: $TOTAL_TIME seconds"
    echo ""
    echo "=== EXECUTION RESULT ==="
    cat /tmp/result_$POLL_COUNT.json | jq .
    exit 0
  elif cat /tmp/result_$POLL_COUNT.json | jq -e '.error' >/dev/null 2>&1; then
    echo "    ❌ Error in result:"
    cat /tmp/result_$POLL_COUNT.json | jq .
    exit 1
  else
    echo "    ⏳ No result yet, response:"
    cat /tmp/result_$POLL_COUNT.json | head -c 200
    echo "..."
    echo "    Waiting 10 seconds before next poll..."
    sleep 10
  fi
done

echo "❌ Timed out after $MAX_POLLS polls"
echo ""
echo "=== Manual Commands for Testing ==="
echo "Create: curl -X POST 'http://localhost:4111/api/workflows/$WORKFLOW_ID/create-run?runId=$RUN_ID' -H 'accept: */*'"
echo ""
echo "Start: curl -X POST 'http://localhost:4111/api/workflows/$WORKFLOW_ID/start?runId=$RUN_ID' -H 'accept: */*' -H 'Content-Type: application/json' -d '{\"inputData\":{\"transcript\":\"user: Hello\\nbill: Hi there!\",\"additionalContext\":{\"scenario\":\"test\",\"participants\":[\"user\",\"bill\"],\"meetingType\":\"test\"}}}'"
echo ""
echo "Check result: curl -X GET 'http://localhost:4111/api/workflows/$WORKFLOW_ID/runs/$RUN_ID/execution-result' -H 'accept: */*'"
echo ""
echo "Run this script again to test with a new run ID"