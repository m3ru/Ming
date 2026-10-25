import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackendSource } from "./backend-runtime.mjs";

const providers = loadBackendSource("src/backend/src/lib/providers.ts");
const { resolveTextProvider, isTextConfigured } = providers;

test("text defaults to Gemini and never borrows an OpenAI key", () => {
  assert.deepEqual(resolveTextProvider({ OPENAI_API_KEY: "openai-only" }), {
    provider: "gemini",
    model: "gemini-3.8-flash",
    apiKey: undefined,
  });
  assert.equal(isTextConfigured({ OPENAI_API_KEY: "openai-only" }), false);
  assert.equal(
    isTextConfigured({
      DEEPGRAM_API_KEY: "voice-only",
      NEXT_PUBLIC_GOOGLE_API_KEY: "public-key",
    }),
    false,
  );
  assert.equal(isTextConfigured({ GEMINI_API_KEY: "gemini-key" }), true);
});

test("Gemini supports explicit model and ordered Google key aliases", () => {
  assert.deepEqual(
    resolveTextProvider({
      GEMINI_API_KEY: "   ",
      GOOGLE_GENERATIVE_AI_API_KEY: " fallback-key ",
      GOOGLE_API_KEY: "last-fallback-key",
      GEMINI_MODEL: " custom-flash ",
    }),
    { provider: "gemini", model: "custom-flash", apiKey: "fallback-key" },
  );
  assert.equal(
    resolveTextProvider({
      GEMINI_API_KEY: " preferred-key ",
      GOOGLE_GENERATIVE_AI_API_KEY: "fallback-key",
      GOOGLE_API_KEY: "last-fallback-key",
    }).apiKey,
    "preferred-key",
  );
  assert.deepEqual(
    resolveTextProvider({
      GEMINI_API_KEY: "   ",
      GOOGLE_GENERATIVE_AI_API_KEY: "\t",
      GOOGLE_API_KEY: " generic-google-key ",
    }),
    { provider: "gemini", model: "gemini-3.8-flash", apiKey: "generic-google-key" },
  );
  assert.equal(isTextConfigured({ GOOGLE_API_KEY: "google-only" }), true);
  assert.equal(isTextConfigured({ GOOGLE_API_KEY: "   " }), false);
});

test("explicit OpenAI selection needs only its own key and honors its model", () => {
  assert.deepEqual(
    resolveTextProvider({
      MING_TEXT_PROVIDER: "openai",
      OPENAI_API_KEY: " openai-key ",
    }),
    { provider: "openai", model: "gpt-5.4-mini", apiKey: "openai-key" },
  );
  assert.equal(
    resolveTextProvider({
      MING_TEXT_PROVIDER: "openai",
      OPENAI_TEXT_MODEL: "custom-openai",
    }).model,
    "custom-openai",
  );
  assert.equal(
    isTextConfigured({
      MING_TEXT_PROVIDER: "openai",
      GEMINI_API_KEY: "gemini-only",
      GOOGLE_GENERATIVE_AI_API_KEY: "google-generative-only",
      GOOGLE_API_KEY: "google-only",
    }),
    false,
  );
  assert.equal(
    isTextConfigured({
      MING_TEXT_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-key",
    }),
    true,
  );
});

test("invalid providers fail with a clear configuration error", () => {
  for (const value of ["anthropic", "gemni"]) {
    assert.throws(
      () => resolveTextProvider({ MING_TEXT_PROVIDER: value }),
      /MING_TEXT_PROVIDER must be "gemini" or "openai"/,
    );
  }
});

for (const { provider, name, keys, selectedKey } of [
  {
    provider: "gemini",
    name: "Gemini primary key",
    keys: {
      GEMINI_API_KEY: "synthetic-gemini-key",
      GOOGLE_GENERATIVE_AI_API_KEY: "synthetic-google-generative-key",
      GOOGLE_API_KEY: "synthetic-google-key",
      OPENAI_API_KEY: "synthetic-openai-key",
    },
    selectedKey: "synthetic-gemini-key",
  },
  {
    provider: "gemini",
    name: "Gemini GOOGLE_API_KEY alias",
    keys: {
      GOOGLE_API_KEY: "synthetic-google-key",
      OPENAI_API_KEY: "synthetic-openai-key",
    },
    selectedKey: "synthetic-google-key",
  },
  {
    provider: "openai",
    name: "OpenAI with unrelated Google keys",
    keys: {
      GEMINI_API_KEY: "synthetic-gemini-key",
      GOOGLE_GENERATIVE_AI_API_KEY: "synthetic-google-generative-key",
      GOOGLE_API_KEY: "synthetic-google-key",
      OPENAI_API_KEY: "synthetic-openai-key",
    },
    selectedKey: "synthetic-openai-key",
  },
]) {
  test(`${name} uses installed AI SDK v2 interface and only its selected key`, async () => {
    const config = resolveTextProvider({
      MING_TEXT_PROVIDER: provider,
      ...keys,
    });
    const { textModel } = loadBackendSource(
      "src/backend/src/mastra/models.ts",
      {
        "../lib/providers": { ...providers, resolveTextProvider: () => config },
      },
    );
    assert.equal(textModel.specificationVersion, "v2");
    assert.equal(textModel.modelId, config.model);
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({
        url: String(url),
        headers: new Headers(options.headers),
        body: JSON.parse(options.body),
      });
      return Response.json(
        provider === "gemini"
          ? {
              candidates: [
                {
                  content: { role: "model", parts: [{ text: "Mock reply" }] },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 1,
                candidatesTokenCount: 2,
                totalTokenCount: 3,
              },
            }
          : {
              id: "mock-id",
              created: 1,
              model: config.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Mock reply" },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              },
            },
      );
    };
    try {
      const result = await textModel.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      });
      assert.equal(result.content[0].text, "Mock reply");
      assert.equal(requests.length, 1);
      const serializedRequest = JSON.stringify({
        ...requests[0],
        headers: Object.fromEntries(requests[0].headers),
      });
      for (const key of Object.values(keys)) {
        if (key !== selectedKey) assert.equal(serializedRequest.includes(key), false);
      }
      if (provider === "gemini") {
        assert.match(
          requests[0].url,
          /generativelanguage\.googleapis\.com.*gemini-3\.8-flash/,
        );
        assert.equal(
          requests[0].headers.get("x-goog-api-key"),
          selectedKey,
        );
        assert.equal(requests[0].headers.get("authorization"), null);
      } else {
        assert.match(
          requests[0].url,
          /api\.openai\.com\/v1\/chat\/completions/,
        );
        assert.equal(
          requests[0].headers.get("authorization"),
          `Bearer ${selectedKey}`,
        );
        assert.equal(requests[0].headers.get("x-goog-api-key"), null);
        assert.equal(requests[0].body.model, "gpt-5.4-mini");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const path of [
  "src/lib/videoUtil.ts",
  "src/backend/src/lib/videoUtil.ts",
]) {
  test(`${path} preserves Veo generation and waits for download with server credentials`, async () => {
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    const previousGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const previousGoogleApiKey = process.env.GOOGLE_API_KEY;
    const previousOpenAIKey = process.env.OPENAI_API_KEY;
    const calls = [];
    class MockGoogleGenAI {
      constructor(options) {
        calls.push(["client", options]);
      }
      models = {
        generateVideos: async (options) => {
          calls.push(["generate", options]);
          return {
            done: true,
            response: { generatedVideos: [{ video: { uri: "mock-video" } }] },
          };
        },
      };
      files = {
        download: async (options) => {
          await Promise.resolve();
          calls.push(["download", options]);
        },
      };
    }
    const { default: generateScenarioVideo } = loadBackendSource(path, {
      "server-only": {},
      "@google/genai": { GoogleGenAI: MockGoogleGenAI },
    });
    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.OPENAI_API_KEY = "unrelated-openai-key";
      await assert.rejects(
        generateScenarioVideo({
          title: "Title",
          situation: "Situation",
          companyDetails: "Culture",
          npcs: [],
          documents: [],
        }),
        /Video generation requires GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or GOOGLE_API_KEY/,
      );
      assert.equal(calls.length, 0);
      process.env.GEMINI_API_KEY = "server-key";
      await generateScenarioVideo({
        title: "Title",
        situation: "Situation",
        companyDetails: "Culture",
        npcs: [
          { name: "Alex", role: "Manager", scenarioSpecificInfo: "Review" },
        ],
        documents: [
          { title: "Memo", type: "text", content: [{ content: "Details" }] },
        ],
      });
      assert.deepEqual(calls[0], ["client", { apiKey: "server-key" }]);
      assert.equal(calls[1][1].model, "veo-3.0-fast-generate-001");
      assert.match(
        calls[1][1].prompt,
        /Title: Title[\s\S]*Alex \(Manager\): Review[\s\S]*Memo \(text\): Details/,
      );
      assert.deepEqual(calls[2], [
        "download",
        { file: { uri: "mock-video" }, downloadPath: "./video.mp4" },
      ]);
      for (const { gemini, googleGenerative, google, expected } of [
        {
          gemini: " primary-key ",
          googleGenerative: "generative-key",
          google: "generic-key",
          expected: "primary-key",
        },
        {
          gemini: " ",
          googleGenerative: " generative-key ",
          google: "generic-key",
          expected: "generative-key",
        },
        {
          gemini: " ",
          googleGenerative: "\t",
          google: " generic-key ",
          expected: "generic-key",
        },
      ]) {
        process.env.GEMINI_API_KEY = gemini;
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = googleGenerative;
        process.env.GOOGLE_API_KEY = google;
        calls.length = 0;
        await generateScenarioVideo({
          title: "Title",
          situation: "Situation",
          companyDetails: "Culture",
          npcs: [],
          documents: [],
        });
        assert.deepEqual(calls[0], ["client", { apiKey: expected }]);
        assert.equal(calls[1][1].model, "veo-3.0-fast-generate-001");
        assert.equal(calls.at(-1)[0], "download");
      }
    } finally {
      if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousGeminiKey;
      if (previousGoogleKey === undefined)
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousGoogleKey;
      if (previousGoogleApiKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = previousGoogleApiKey;
      if (previousOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAIKey;
    }
  });
}

test("tone scoring and Live voice lookups leave Gemini room to think before answering", async () => {
  const prompts = loadBackendSource("src/backend/src/lib/prompts.ts");
  const voice = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": prompts });
  const calls = [];
  class Agent {
    async generateVNext(_messages, options) {
      calls.push(options);
      return { object: { score: 0.5, magnitude: 0.5 }, text: "A spoken reply." };
    }
  }
  const { scoreSentiment } = loadBackendSource("src/backend/src/mastra/sentiment.ts", {
    "@mastra/core/agent": { Agent },
    "../lib/providers": providers,
    "../lib/sentiment": loadBackendSource("src/backend/src/lib/sentiment.ts"),
    "./models": { textModel: {} },
  });
  const { liveVoice } = loadBackendSource("src/backend/src/mastra/liveVoice.ts", {
    "@mastra/core/agent": { Agent },
    "../lib/voice": { ...voice, createLiveVoiceService: (dependencies) => dependencies },
    "../lib/prompts": prompts,
    "../lib/providers": providers,
    "./agents/defaultAgent": { defaultAgent: {} },
    "./models": { textModel: {} },
  });
  const context = { chatType: { data: "scenario" }, scenarioDetails: { data: { title: "Review" } } };
  const original = { MING_TEXT_PROVIDER: process.env.MING_TEXT_PROVIDER, GEMINI_MODEL: process.env.GEMINI_MODEL };
  try {
    for (const [provider, model, lowThinking] of [
      ["gemini", "gemini-3.8-flash", true],
      ["gemini", "gemini-2.5-flash", false],
      ["openai", "gemini-3.8-flash", false],
    ]) {
      process.env.MING_TEXT_PROVIDER = provider;
      process.env.GEMINI_MODEL = model;
      calls.length = 0;
      await scoreSentiment("Thanks for making time.", new AbortController().signal);
      await liveVoice.generate([{ role: "user", content: "Hi Bart" }], context);
      const thinking = lowThinking ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined;
      // Gemini counts thinking against the cap; a tight cap truncates the reply (frozen tone gauge).
      assert.equal(calls[0].modelSettings.maxOutputTokens, provider === "gemini" ? 1024 : 150);
      assert.deepEqual(calls[0].providerOptions, thinking);
      assert.equal(calls[1].modelSettings.maxOutputTokens, provider === "gemini" ? 1024 : 250);
      assert.deepEqual(calls[1].providerOptions, thinking);
      assert.ok(calls[1].abortSignal instanceof AbortSignal);
    }
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
