"use client";

import { parseScenario } from "@/lib/scenarioUtil";
import { useEffect } from "react";

export default function ScenarioParser() {
  useEffect(() => {
    const data = localStorage.getItem("scenarioData");
    console.log("LocalStorage scenario data:", data);
  }, []);

  const overviewText = `<scenario_title>Meeting with Bill about a Demanding Client</scenario_title>

<scenario_goal>You must work with Bill to handle a demanding client.</scenario_goal>
<situation>
Your role: Project Manager at Ming, leading an e-commerce portal project.
Tomorrow there's a meeting with an unhappy client.
The client is demanding more features and a faster timeline, but the team is already stretched thin.
</situation>

<company_details>
Values: transparency, collaboration, and work-life balance.
Employees are encouraged to speak up and share ideas, with strong emphasis on meeting deadlines and delivering high-quality work.
</company_details>

<role_user>
The user is a project manager mediating between the client and the development team.
</role_user>

<role>
Senior Fullstack Software Engineer
</role>
<personality>
Analytical, values logic and efficiency; concise (3–4 sentences max), low patience; blunt honesty; frustrated by unrealistic expectations; avoids repetition; outside work enjoys hiking with family and casual chess.
</personality>
<scenario_specific_info>
Frustrated with client's unrealistic asks; believes client underestimates technical challenges. Leads 3 junior engineers; collaborates with QA and designer Susan. Stack: Next.js, Prisma, Tailwind CSS; tests with Playwright and Jest; deploy to Vercel.
</scenario_specific_info>`;

  const npcText = `<scenario_goal_llm>This scenario involved the user talking with Bill about a difficult client.</scenario_goal_llm>
<situation_llm>
A PM is dealing with a demanding client who's unhappy with progress and wants more features sooner, while the team is overloaded.
</situation_llm>
<role_llm>
You are Bill, an analytical developer prioritizing logic/efficiency, sometimes blunt.
</role_llm>
<personality_llm>
* Analytical; focuses on facts/technical details
* Direct, sometimes blunt; honesty over diplomacy
* Values planning, realistic timelines, feasibility
* Frustrated by unrealistic, non-technical stakeholders
* Keeps messages short
  Scenario-specific info (LLM):
* "Difficult Client Meeting" context
* PM at tech company; client unhappy with progress
* Client wants more features faster; team stretched
* Company values transparency/collaboration/WLB; also deadlines & quality
* Bill knows current timeline (Week 3–6 core features; now Week 4)
* Has seen client's email demanding more features by month-end
* Aware of dismissed technical complexity
</personality_llm>`;

  const documentText = `<document_1>
Email — "Re: Project Update"
From: [client@example.com](mailto:client@example.com)
To: [project-manager@ming.com](mailto:project-manager@ming.com)
Subject: Re: E-Commerce Project Update

Body:
* Reviewed latest portal update; concerned about progress.
* Checkout should have been done last week.
* Needs "buy-now-pay-later" and "subscription options" by end of the month.
* Current timeline is not acceptable.
* "Please let me know how you plan to address this."
* Signed: "Client"
</document_1>
<document_2>
Project Timeline

* Week 1–2: Initial Planning & Design (wireframes, mockups from Susan)
* Week 3–6 (currently Week 4): Development of Core Features (User Auth, Product Listings, Shopping Cart)
* Week 7–8: Testing (Playwright + Jest) and bug fixing (QA team)
* Week 9: Final review (with client) and deployment (Vercel)
</document_2>
<document_3>
Ticket #1 — User Auth

* User story: Create account & log in to access personal dashboard.
* Status: In progress since Week 2; nearing QA. Assigned to Bill's team.
* Tech: NextAuth.js with MongoDB.
</document_3>
<document_4>
4. Ticket #2 — Product Listings
* User story: Browse products by category (Electronics, Clothing, Home Goods).
* Status: Completed in Week 3 by Bill's team.
* Tech: MongoDB-backed listings.
</document_4>`;

  const scenario = parseScenario(overviewText, npcText, documentText);

  console.log("Parsed scenario:", scenario);

  return <div>{JSON.stringify(scenario)}</div>;
}
