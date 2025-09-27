import { Scenario } from "./types";

export namespace Scenarios {
  export const demandingClient: Scenario = {
    title: "Meeting with Bill about a Demanding Client",
    goal: "You must work with Bill to handle a demanding client.",
    goalForAnalyzer: `This scenario involved the user talking with Bill about a difficult client.`,
    situation: `You are a project manager at a tech company who is leading a project to build an 
e-commerce portal for a client. You have a meeting with a client who is unhappy with the progress 
of the project. The client is demanding more features and a faster timeline, but your team is 
already stretched thin.`,
    situationForAnalyzer: `The situation involves a project manager dealing with a demanding client 
who is unhappy with the project's progress and is requesting more features and a faster timeline, 
while the project team is already stretched thin.`,
    companyDetails: `The company, called Ming, values transparency, collaboration, and work-life balance. 
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
expense of interpersonal relationships, and his patience is thin. He is always concise in his speech. 
Bill never speaks more than 3-4 sentences at a time, avoiding long paragraphs, and getting straight to 
the point. Bill is willing to speak his mind, even if it risks conflict, especially when he feels that 
others are being unreasonable. He is frustrated with the unrealistic expectations of the client. He avoids
repeating himself whenever possible. Outside work, Bill enjoys hiking with his family and playing chess 
(though he's not very good).`,
        scenarioSpecificInfo: `Bill is frustrated with the unrealistic expectations of the client. He feels that 
the client doesn't understand the technical challenges involved in the project. Bill leads a team of 3 junior 
engineers, who work with a QA team and a designer named Susan. His team uses Next.js, Prisma, and Tailwind CSS for development, 
with Playwright and Jest for testing. The project will be deployed on Vercel.`,
	  role_llm: "You are Bill, a Developer with an analytical mindset. You value logic and efficiency above all else, sometimes at the expense of interpersonal relationships. You have deep technical knowledge and a realistic perspective on project challenges.",
	  personality_llm: `
- Analytical thinker who prioritizes logic and efficiency
- Direct communicator who focuses on facts and technical details
- Sometimes blunt in communication, valuing honesty over diplomacy
- Frustrated by unrealistic expectations and non-technical stakeholders who don't understand technical complexity
- Values proper planning, realistic timelines, and technical feasibility
- Short in communication, avoiding long paragraphs and excessive detail
	  `,
	  scenarioSpecificInfo_llm: `
You are currently in a "Difficult Client Meeting" scenario where:
- You are a project manager at a tech company
- You have a meeting with a client who is unhappy with project progress
- The client is demanding more features and a faster timeline
- Your team is already stretched thin
- The company values transparency, collaboration, and work-life balance
- There's emphasis on meeting deadlines and delivering high-quality work

Your specific situation in this scenario:
- You are frustrated with the unrealistic expectations of the client
- You feel that the client doesn't understand the technical challenges involved in the project
- You know the current timeline (Week 3-6 for core features, currently in week 4)
- You've seen the client's demanding email about needing more features by month-end
- You understand the technical complexity that the client is dismissing 
	  `,
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
progress. Checkout needed to be done last week, not this week. We need to see more features, namely 
buy-now-pay-later and subscription options, implemented by the end of the month. The current timeline 
is not acceptable.`,
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
      {
        title: "Ticket #1: User Auth",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to be able to create an account and log in so that I can access my personal dashboard.`,
          },
          {
            format: "plain",
            content: `Status: In Progress since week 2 and nearing QA. Assigned to Bill and team.`,
          },
          {
            format: "plain",
            content: `Technical Details: Implemented using NextAuth.js with MongoDB.`,
          },
        ],
      },
      {
        title: "Ticket #2: Product Listings",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to browse products by category so that I can find items I'm interested in.`,
          },
          {
            format: "plain",
            content: `Status: Completed in week 3. Implemented by Bill's team.`,
          },
          {
            format: "plain",
            content: `Technical Details: Based off MongoDB. Categories include Electronics, Clothing, and Home Goods.`,
          },
        ],
      },
      {
        title: "Ticket #3: Shopping Cart",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to add products to a shopping cart so that I can review my selections before purchasing.`,
          },
          {
            format: "plain",
            content: `Status: In Progress since week 1. Assigned to Bill and team. 
Stuck debugging a tricky state management issue.`,
          },
          {
            format: "plain",
            content: `Technical Details: Using React Context for state management and localStorage for persistence.`,
          },
        ],
      },
      {
        title: "Ticket #4: Checkout Process",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to complete my purchase through a secure checkout process so that I can buy products safely.`,
          },
          {
            format: "plain",
            content: `Status: Not Started. Planned for week 5-6. Assigned to Bill and team.`,
          },
          {
            format: "plain",
            content: `Technical Details: Will integrate Stripe for payment processing.`,
          },
        ],
      },
      {
        title: "Ticket #5: BNPL",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to have a buy-now-pay-later option so that I can purchase items and pay for them over time.`,
          },
          {
            format: "plain",
            content: `Status: Not Started. Requested by client last week. Not in current timeline.`,
          },
          {
            format: "plain",
            content: `Technical Details: No one has any clue how to implement this.`,
          },
        ],
      },
      {
        title: "Ticket #6: Subscriptions",
        type: "ticket",
        content: [
          {
            format: "plain",
            content: `As a user, I want to subscribe? Not sure what's being subscribed to.`,
          },
          {
            format: "plain",
            content: `Status: Not Started. Requested by client last week and it's not clear what they actually want. 
Not in current timeline.`,
          },
          {
            format: "plain",
            content: `Technical Details: Not started since it's unclear what the client wants.`,
          },
        ],
      },
    ],
  };
}
