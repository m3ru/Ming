export type Sentiment = {
  magnitude: number;
  score: number;
};

export async function analyzeSentiment(text: string) {
  const res = await fetch(
    `https://language.googleapis.com/v2/documents:analyzeSentiment?key=${process.env.NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_API_KEY}`,
    {
      method: "POST",
      body: JSON.stringify({
        document: {
          type: "PLAIN_TEXT",
          // language: "en",
          content: text,
        },
        encodingType: "UTF8",
      }),
    }
  );

  const data = await res.json();
  return data.documentSentiment as Sentiment;
}
