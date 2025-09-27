export type Scenario = {
  title: string;
  situation: string;
  companyCulture: string;
  npcs: Npc[];
  documents: ScenarioDocument[];
};

export type Npc = {
  name: string;
  role: string;
  personality: string;
  scenarioSpecificInfo: string;
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
