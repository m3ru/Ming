export const scenarioFixture = {
  title: "Agree on an achievable handoff",
  goal: "Clarify Bart's concern before agreeing on an owner and deadline.",
  goalForAnalyzer: "Practice the feedback about jumping to solutions: ask an open question, reflect Bart's concern, then confirm an owner and deadline.",
  situation: "You lead Ming's platform team. Bart must hand a checkout change to QA tomorrow, but the acceptance criteria conflict. Meet to resolve the handoff together.",
  situationForAnalyzer: "The learner should explore the conflicting checkout requirements, acknowledge Bart's concern, and agree on one observable handoff commitment.",
  companyDetails: "Ming values clear expectations, collaborative decisions, and sustainable delivery.",
  userRole: "Engineering Manager leading Bart's platform team.",
  npcs: [{
    name: "Bart",
    role: "Mid-level full-stack engineer",
    pfp: "https://randomuser.me/api/portraits/men/12.jpg",
    personality: "Conscientious and worried about contradictory requirements. Explain your concern if asked and become more cooperative when it is accurately reflected.",
    scenarioSpecificInfo: "QA needs the checkout handoff tomorrow at 15:00. Ticket 604 allows guest checkout while the release checklist requires login. Ask the manager to choose one acceptance rule and owner.",
  }],
  documents: [{
    title: "Checkout handoff notes",
    type: "ticket",
    content: [
      { format: "bold", content: "Decision needed before tomorrow at 15:00." },
      { format: "plain", content: "Ticket 604 allows guest checkout. The release checklist requires login. QA needs one agreed acceptance rule and an owner." },
    ],
  }],
};
