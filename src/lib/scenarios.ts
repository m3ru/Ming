import { Scenario } from "./types";

export namespace Scenarios {
  export const demandingClient: Scenario = {
    title: "Difficult Client Meeting",
    description: "You must work with Bill to handle a demanding client.",
    situation: `You are a project manager at a tech company who is leading a project to build an 
e-commerce portal for a client. You have a meeting with a client who is unhappy with the progress 
of the project. The client is demanding more features and a faster timeline, but your team is 
already stretched thin.`,
    companyDetails: `Your company, called Ming, values transparency, collaboration, and work-life balance. 
Employees are encouraged to speak up and share their ideas, but there is also a strong emphasis 
on meeting deadlines and delivering high-quality work. The company takes Fridays off and is fully remote.`,
    userRole:
      "The user is a project manager trying to mediate between the client and the development team.",
    npcs: [
      {
        name: "Bill",
        role: "Senior Fullstack Software Engineer",
        pfp: "https://randomuser.me/api/portraits/men/1.jpg",
        personality: `Bill is an analytical thinker who values logic and efficiency, sometimes at the 
expense of interpersonal relationships. He is always concise in his speech.`,
        scenarioSpecificInfo: `Bill is frustrated with the unrealistic expectations of the client. He feels that 
the client doesn't understand the technical challenges involved in the project. Bill leads a team of 3 junior 
engineers, who work with a QA team and a designer named Susan. His team uses Next.js, Prisma, and Tailwind CSS for development, 
with Playwright and Jest for testing. The project will be deployed on Vercel.`,
      },
    ],
    documents: [
      {
        title: "Re: Project Update",
        type: "email",
        content: [
          { format: "bold", content: "From: client@example.com" },
          { format: "bold", content: "To: project-manager@ming.com" },
          { format: "bold", content: "Subject: Re: E-Commerce Project Update" },
          { format: "plain", content: "Hi," },
          {
            format: "plain",
            content: `I reviewed the latest update on the portal, and I'm quite concerned about the 
progress. Checkout needed to be done last week, not this week. We need to see more features, namely buy-now-pay-later and subscription options, implemented by 
the end of the month. The current timeline is not acceptable.`,
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
            content:
              "Week 1-2: Initial Planning and Design (wireframes, mockups from Susan on design)",
          },
          {
            format: "bold",
            content:
              "Week 3-6 (currently week 4): Development of Core Features (User Auth, Product Listings, Shopping Cart)",
          },
          {
            format: "plain",
            content:
              "Week 7-8: Testing (Playwright + Jest) and Bug Fixing (send to QA team)",
          },
          {
            format: "bold",
            content:
              "Week 9: Final Review (with client) and Deployment (to Vercel)",
          },
        ],
      },
    ],
  };
}
