import { Scenario } from "./types";

export namespace Scenarios {
  export const demandingClient: Scenario = {
    title: "Difficult Client Meeting",
    situation:
      "You are a project manager at a tech company. You have a meeting with a client who is unhappy with the progress of the project. The client is demanding more features and a faster timeline, but your team is already stretched thin.",
    companyCulture:
      "Your company values transparency, collaboration, and work-life balance. Employees are encouraged to speak up and share their ideas, but there is also a strong emphasis on meeting deadlines and delivering high-quality work.",
    npcs: [
      {
        name: "Bill",
        role: "Developer",
        personality:
          "Bill is an analytical thinker who values logic and efficiency, sometimes at the expense of interpersonal relationships.",
        scenarioSpecificInfo:
          "Bill is frustrated with the unrealistic expectations of the client. He feels that the client doesn't understand the technical challenges involved in the project.",
      },
      {
        name: "Susan",
        role: "Designer",
        personality:
          "Susan is a creative and empathetic individual who prioritizes user experience and aesthetics, often advocating for the end-user's perspective.",
        scenarioSpecificInfo:
          "Susan is trying to balance the client's demands with the team's capacity. She believes that the client needs to be educated about the design process.",
      },
    ],
    documents: [
      {
        title: "Re: Project Update",
        type: "email",
        content: [
          { format: "bold", content: "From: client@example.com" },
          { format: "bold", content: "To: project-manager@example.com" },
          { format: "bold", content: "Subject: Re: Project Update" },
          { format: "plain", content: "Hi," },
          {
            format: "plain",
            content:
              "I reviewed the latest update on the project, and I'm quite concerned about the progress. " +
              "We need to see more features implemented by the end of the month. The current timeline is not acceptable.",
          },
          {
            format: "plain",
            content: "Please let me know how you plan to address this.",
          },
          { format: "plain", content: "Best," },
          { format: "plain", content: "Client" },
        ],
      },
      {
        title: "Project Timeline",
        type: "timeline",
        content: [
          {
            format: "plain",
            content: "Week 1-2: Initial Planning and Design",
          },
          {
            format: "bold",
            content:
              "Week 3-6 (currently week 4): Development of Core Features",
          },
          {
            format: "plain",
            content: "Week 7-8: Testing and Bug Fixing",
          },
          {
            format: "bold",
            content: "Week 9: Final Review and Deployment",
          },
        ],
      },
    ],
  };
}
