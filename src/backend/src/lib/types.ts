export type Scenario = {
  title: string;
  goal: string;
  goalForAnalyzer: string;
  situation: string;
  situationForAnalyzer: string;
  companyDetails: string;
  userRole: string;
  npcs: Npc[];
  documents: ScenarioDocument[];
};

export type Npc = {
  name: string;
  role: string;
  pfp: string;
  personality: string;
  scenarioSpecificInfo: string;
  role_llm: string;
  personality_llm?: string;
  scenarioSpecificInfo_llm?: string;
};

export type ScenarioDocument = {
  title: string;
  type: string;
  content: ScenarioDocumentBlock[];
};

export type ScenarioDocumentBlock = {
  format: "plain" | "bold" | "italic" | "code";
  content: string;
};
