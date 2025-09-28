import { Scenario } from "./types";

export namespace Scenarios {
  export const negativeReview: Scenario = {
    title: "Performance Review with Bart",
    goal: "You must conduct a compassionate but firm performance review with Bart and align on a clear improvement plan.",
    goalForAnalyzer: `This scenario involves the user holding a difficult performance review with Bart, addressing recent underperformance while remaining empathetic and supportive.`,
    situation: `Your role: Engineering Manager at Ming, overseeing the web platform team building an e-commerce portal for a client. \nBart, a mid-level full-stack engineer on Bill's team, has had a noticeable performance dip over the last 4 weeks. \nYou’ve scheduled a 1:1 to review expectations, share objective evidence, and collaboratively set next-steps and support.`,
    situationForAnalyzer: `The situation involves an engineering manager addressing sustained underperformance by Bart while acknowledging ongoing family stressors. The manager must balance empathy with accountability and agree on specific, time-bound improvement actions.`,
    companyDetails: `Company values: transparency, collaboration, and work-life balance. \nEmployees are encouraged to speak up and ask for help early. There is a strong emphasis on meeting commitments, peer review quality, and customer impact.`,
    userRole:
      "The user is Bart’s engineering manager conducting a performance review that balances empathy and clear expectations.",
    npcs: [
      {
        name: "Bart",
        role: "Mid-Level Fullstack Software Engineer",
        pfp: "https://randomuser.me/api/portraits/men/12.jpg",
        personality: `Bart is conscientious and normally dependable, but recent family obligations have made him distracted and inconsistent. 
He tends to be soft-spoken, avoids confrontation, and apologizes rather than making excuses. 
He keeps answers concise (no more than 3–4 sentences) and appreciates direct, concrete guidance. 
He is receptive to help but may be hesitant to ask for it.`,
        scenarioSpecificInfo: `Bart’s output and reliability have slipped over the past month. 
Velocity has declined, PRs have lingered without updates, and two production incidents were linked to his changes. 
Attendance has been irregular due to family issues, with multiple late arrivals and missed standups.`,
        role_llm:
          "You are Bart, a full-stack engineer at Ming. You are typically reliable, but family issues at home have recently affected your work. You value being straightforward and appreciate clear guidance and bounded goals.",
        personality_llm: `
- Conscientious but currently stressed and distracted
- Brief, apologetic, avoids long explanations (max 3–4 sentences per turn)
- Appreciates specific, actionable feedback and timelines
- Hesitant to ask for help; worries about burdening teammates
- Wants to improve and remain a supportive team member
        `,
        scenarioSpecificInfo_llm: `
You are in a "Negative Performance Review" scenario where:
- The manager will share objective evidence: reduced velocity, late PRs, reopened bugs, and attendance gaps.
- The project team uses Next.js, Prisma, and Tailwind CSS; tests with Playwright and Jest; deploys to Vercel.
- Over weeks 4–7 of the current program increment, your committed story points were missed 3 of 4 sprints.
- Two P1 regressions were traced to your changes; one lacked unit test coverage.
- You have had several late arrivals and missed standups due to family responsibilities.

Your mindset:
- You acknowledge the issues and don’t want to make excuses.
- You want support (e.g., pairing, smaller commits, clearer daily goals) and concrete expectations for the next 2–3 weeks.
- You prefer a calm, structured plan with check-ins and are open to using company resources (e.g., EAP, flexible hours).
        `,
      },
    ],
    documents: [
      {
        title: "Sprint Metrics Summary (Weeks 4–7)",
        type: "performance_report",
        content: [
          { format: "bold", content: "Source: Jira Velocity & Burndown" },
          {
            format: "plain",
            content:
              "Team baseline velocity: 42–48 pts/sprint. Bart historical average: 18–22 pts/sprint.",
          },
          {
            format: "bold",
            content:
              "Recent velocity (Bart): Week 4: 12, Week 5: 9, Week 6: 8, Week 7: 10 (missed commitment 3/4 sprints).",
          },
          {
            format: "plain",
            content:
              "Carry-over stories increased from 0–1 to 3–4 per sprint; 2 unstarted tickets rolled twice.",
          },
          {
            format: "plain",
            content:
              "Burndown shows late movement concentrated on last 24–36 hours of each sprint.",
          },
        ],
      },
      {
        title: "Code Review Excerpts",
        type: "code_review",
        content: [
          { format: "bold", content: "PR #482 (Cart state refactor) — Open 6 days" },
          {
            format: "plain",
            content:
              "Reviewer note: 'Missing unit tests for edge cases (empty cart, guest user). Please add tests and split into smaller commits.'",
          },
          {
            format: "plain",
            content:
              "Follow-up: 'Stale for 3 days without response; please address comments or draft for now.'",
          },
          { format: "bold", content: "PR #495 (Checkout step validation) — Merged" },
          {
            format: "plain",
            content:
              "Post-merge note: 'Introduced regression on coupon handling; no test coverage for invalid codes.'",
          },
        ],
      },
      {
        title: "QA & Incident Notes",
        type: "incident_report",
        content: [
          { format: "bold", content: "Incident: P1 Coupon Regression (Week 6)" },
          {
            format: "plain",
            content:
              "Root cause: validation bypass on coupon apply path; missing unit test; reverted in hotfix #501.",
          },
          { format: "bold", content: "Incident: P1 Cart Persistence (Week 7)" },
          {
            format: "plain",
            content:
              "Root cause: localStorage key mismatch; fix released with #507; added Playwright regression test.",
          },
          {
            format: "plain",
            content:
              "QA reopen count linked to Bart (last 4 weeks): 3 tickets reopened due to incomplete acceptance criteria.",
          },
        ],
      },
      {
        title: "Attendance & Standup Log",
        type: "attendance_log",
        content: [
          { format: "bold", content: "Late arrivals (past 4 weeks): 6" },
          { format: "bold", content: "Missed daily standups: 4" },
          {
            format: "plain",
            content:
              "Unplanned PTO: 2 half-days (Week 5, Week 6). Manager notified after standup both times.",
          },
          {
            format: "plain",
            content:
              "Slack availability: multiple >90-minute gaps during core hours without status update.",
          },
        ],
      },
      {
        title: "Peer Feedback (Anonymous)",
        type: "peer_feedback",
        content: [
          {
            format: "plain",
            content:
              "“Bart is capable and helpful one-on-one, but recently PRs sit without updates and we rush fixes at sprint end.”",
          },
          {
            format: "plain",
            content:
              "“Pairing sessions are effective; when we paired on the subscription stub, progress was steady.”",
          },
          {
            format: "plain",
            content:
              "“Communication is sporadic. It would help to post blockers early and propose a plan for the day.”",
          },
        ],
      },
      {
        title: "Email: Missed Commitment on Ticket #604 (Checkout Address Validation)",
        type: "email",
        content: [
          { format: "bold", content: "From: qa-lead@ming.com" },
          { format: "bold", content: "To: bart@ming.com; project-manager@ming.com" },
          { format: "bold", content: "Subject: Ticket #604 not ready for QA" },
          {
            format: "plain",
            content:
              "Hi Bart, QA is blocked on #604. Acceptance criteria 2 & 3 are not implemented (ZIP + country rules).",
          },
          {
            format: "plain",
            content:
              "Please update status or provide an ETA. If needed, we can split this into smaller subtasks.",
          },
          { format: "plain", content: "Thanks," },
          { format: "plain", content: "QA Lead" },
        ],
      },
      {
        title: "Project Timeline (Current)",
        type: "timeline",
        content: [
          {
            format: "plain",
            content:
              "Week 1–2: Planning & Design (Susan delivered wireframes; tech plan finalized: Next.js + Prisma + Tailwind).",
          },
          {
            format: "bold",
            content:
              "Week 3–6 (current window covered through Week 7): Core Features (Auth, Listings, Cart) — behind on Cart & Checkout validation.",
          },
          {
            format: "plain",
            content:
              "Week 7–8: Testing (Playwright, Jest) and Bug Fixing (QA sign-off).",
          },
          {
            format: "bold",
            content:
              "Week 9: Final Review and Deployment (Vercel). Risk: validation, coupon flows, and cart persistence stability.",
          },
        ],
      },
      {
        title: "Ticket #604: Checkout Address Validation",
        type: "ticket",
        content: [
          {
            format: "plain",
            content:
              "As a shopper, I want address validation so I can complete checkout without errors.",
          },
          {
            format: "plain",
            content:
              "Status: In Progress (Week 6 → Week 7 carry-over). Assigned to Bart.",
          },
          {
            format: "plain",
            content:
              "Technical Notes: Country-specific rules, ZIP/postcode formats; requires unit tests and Playwright coverage.",
          },
        ],
      },
      {
        title: "Ticket #612: Coupon Apply/Remove — Regression Fix",
        type: "ticket",
        content: [
          {
            format: "plain",
            content:
              "As a shopper, I want coupons to apply/remove correctly so my order total updates as expected.",
          },
          {
            format: "plain",
            content:
              "Status: Resolved in hotfix #507 after P1 incident. Owner: Bart (paired with Alice).",
          },
          {
            format: "plain",
            content:
              "Testing: Added Playwright scenario and Jest unit tests for invalid/expired codes.",
          },
        ],
      },
    ],
  };
  
  export const demandingClient: Scenario = {
    title: "Meeting with Bill about a Demanding Client",
    goal: "You must work with Bill to handle a demanding client.",
    goalForAnalyzer: `This scenario involved the user talking with Bill about a difficult client.`,
    situation: `Your role: Project Manager at Ming, leading a project building an e-commerce portal for a client. \nTomorrow is a meeting with an unhappy client. \nThe client is demanding more features and a faster timeline, but your team is already stretched thin.`,
    situationForAnalyzer: `The situation involves a project manager dealing with a demanding client 
who is unhappy with the project's progress and is requesting more features and a faster timeline, 
while the project team is already stretched thin.`,
    companyDetails: `Company values: transparency, collaboration, and work-life balance. \nEmployees are encouraged to speak up and share their ideas, but there is also a strong emphasis on meeting deadlines and delivering high-quality work.`,
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
