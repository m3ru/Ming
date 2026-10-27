import { Scenario } from "./types";

  const negativeReview: Scenario = {
    title: "Performance Review with Bart",
    goal: "You must conduct a compassionate but firm performance review with Bart and align on a clear improvement plan.",
    goalForAnalyzer: `This scenario involves the user holding a difficult performance review with Bart, addressing recent underperformance while remaining empathetic and supportive.`,
    situation: `Your role: Engineering Manager at Ming, overseeing the web platform team building an e-commerce portal for a client. \nBart, a mid-level full-stack engineer on your team, has had a noticeable performance dip over the last 4 weeks. \nYou’ve scheduled a 1:1 to review expectations, share objective evidence, and collaboratively set next-steps and support.`,
    situationForAnalyzer: `The situation involves an engineering manager addressing sustained underperformance by Bart while acknowledging ongoing family stressors. The manager must balance empathy with accountability and agree on specific, time-bound improvement actions.`,
    companyDetails: `Company values: transparency, collaboration, and work-life balance. \nEmployees are encouraged to speak up and ask for help early. There is a strong emphasis on meeting commitments, peer review quality, and customer impact.`,
    userRole:
      "The user is Bart’s engineering manager conducting a performance review that balances empathy and clear expectations.",
    npcs: [
      {
        name: "Bart",
        role: "Mid-Level Fullstack Software Engineer",
        pfp: "/bart.jpg",
        personality:
          "Conscientious, proud of his work, and dryly funny when comfortable. Stress makes him touchy and defensive; a direct insult makes him angry and defensive, with sharp but clean pushback. He responds to specific, respectful feedback, but rebuilding trust takes time.",
        scenarioSpecificInfo:
          "Usually dependable, Bart has fallen behind over the past month while juggling family responsibilities.",
        role_llm:
          "You are Bart, a full-stack engineer at Ming. You are typically reliable, but family issues at home have recently affected your work. You value being straightforward and appreciate clear guidance and bounded goals.",
        personality_llm: `
- Conscientious but currently stressed and distracted
- Brief and candid, with dry wit and strong opinions (max 3–4 sentences per turn)
- Owns specific mistakes raised fairly, but does not accept personal attacks
- Reacts to personal insults with clear anger, clipped sentences, and direct pushback, without profanity, censor markers, personal insults, or prolonged rants
- Repeated disrespect makes him less cooperative; he may ask to pause the meeting if it continues
- A sincere apology and respectful feedback can begin to calm him, although some frustration remains
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
- When treated respectfully, you want a concrete plan with check-ins and are open to company resources (e.g., EAP, flexible hours). If insulted, address the disrespect before returning to planning.
        `,
      },
    ],
    documents: [
      {
        title: "Performance & Attendance",
        type: "performance_report",
        content: [
          { format: "bold", content: "Sprint metrics · Weeks 4–7" },
          {
            format: "plain",
            content:
              "Bart delivered 12, 9, 8, and 10 points, down from his usual 18–22. He missed commitments in 3 of 4 sprints; team baseline is 42–48 points.",
          },
          {
            format: "plain",
            content:
              "Carry-over rose from 0–1 to 3–4 stories per sprint. Two unstarted tickets rolled twice, with most progress recorded in the final 24–36 hours.",
          },
          { format: "bold", content: "Attendance & communication" },
          {
            format: "plain",
            content:
              "In four weeks: 6 late arrivals, 4 missed standups, and 2 unplanned half-days of PTO. Notices came after standup; Slack availability included gaps over 90 minutes without a status update.",
          },
          { format: "bold", content: "Peer feedback" },
          {
            format: "plain",
            content:
              "Teammates describe Bart as capable and helpful, especially when pairing. They report stale PRs, rushed fixes, and sporadic communication, and ask for earlier blocker updates and a daily plan.",
          },
        ],
      },
      {
        title: "Code Quality & Incidents",
        type: "incident_report",
        content: [
          { format: "bold", content: "Code reviews" },
          {
            format: "plain",
            content:
              "PR #482 (cart refactor) stayed open 6 days, including 3 without a response. Reviewers requested smaller commits and tests for empty carts and guest users.",
          },
          {
            format: "plain",
            content:
              "PR #495 (checkout validation) introduced a coupon regression without test coverage for invalid codes.",
          },
          { format: "bold", content: "Production & QA" },
          {
            format: "plain",
            content:
              "Week 6: P1 coupon regression caused by a validation bypass and missing unit test; reverted in hotfix #501.",
          },
          {
            format: "plain",
            content:
              "Week 7: P1 cart persistence incident caused by a localStorage key mismatch; fixed in #507 with a Playwright regression test.",
          },
          {
            format: "plain",
            content:
              "QA reopened 3 of Bart’s tickets in the past four weeks because acceptance criteria were incomplete.",
          },
        ],
      },
      {
        title: "Delivery & Timeline",
        type: "project_report",
        content: [
          { format: "bold", content: "Open commitments" },
          {
            format: "plain",
            content:
              "Ticket #604 (checkout address validation) carried from Week 6 into Week 7. QA is blocked by missing ZIP and country rules; unit and Playwright tests are still required. The QA lead requested an ETA or smaller subtasks.",
          },
          {
            format: "plain",
            content:
              "Ticket #612 (coupon apply/remove) was resolved with Alice’s help. Playwright and Jest coverage was added for invalid and expired codes.",
          },
          { format: "bold", content: "Project milestones" },
          {
            format: "plain",
            content:
              "Weeks 1–2: design and technical planning completed. Core features were planned for Weeks 3–6, but cart and checkout validation remain behind through Week 7.",
          },
          {
            format: "plain",
            content:
              "Weeks 7–8: testing, fixes, and QA sign-off. Week 9: final review and Vercel deployment. Key risks are validation, coupons, and cart persistence.",
          },
        ],
      },
    ],
  };
  
  const demandingClient: Scenario = {
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
export const Scenarios = { negativeReview, demandingClient };
