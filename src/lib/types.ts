export type Scenario = {
  title: string;
  situation: string;
  companyCulture: string;
  npcs: Npc[];
};

export type Npc = {
  name: string;
  role: string;
  personality: string;
  scenarioSpecificInfo: string;
};
