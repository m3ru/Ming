# Ming Management Training - Awarded "Best Use of Google Gemini" at HackGT 12
An AI-native learning and development platform that upskills engineers into managers through personalized, immersive training.

## Features

- Realtime voice chat
- Live sentiment analysis
- Annotated transcripts with feedback
- Personalized scenario creation

## Stack

- Mastra backend
- Gemini for sentiment analysis and text generation
- OpenAI for speech to text and text to speech
- Next.js frontend w/ Shadcan and CedarOS
- Deployed with Cloudflare and AWS

# Set up
1. Clone the repository
2. Run `npm i` in the root folder
3. Run `npm i` in `src/backend`
4. Add `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, and `NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_API_KEY` to your .env file
5. Start the server with `npm run dev`
6. Connect at `http://localhost:3000`!
