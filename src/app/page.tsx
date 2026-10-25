import ScenarioCard from "@/components/ScenarioCard";
import ScoreCard from "@/components/ScoreCard";
import AchievementsCard from "@/components/AchievementsCard";
import ProgressCard from "@/components/ProgressCard";
import { Scenarios } from "@/backend/src/lib/scenarios";

const [bart] = Scenarios.negativeReview.npcs;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-10 sm:px-6 lg:px-8 lg:pt-14">
      <header>
        <div className="flex items-end gap-10">
          <h1 className="swipe swipe-draw rise text-5xl font-black leading-none tracking-tight text-ink sm:text-7xl lg:text-8xl">
            Welcome back
          </h1>
          <p
            className="hand write-in hidden -rotate-3 pb-4 text-[34px] text-pencil lg:block"
            style={{ animationDelay: "520ms" }}
          >
            rehearse it here first
          </p>
        </div>
        <p className="rise mt-5 text-lg text-ink-soft sm:text-xl" style={{ animationDelay: "90ms" }}>
          Practice hard management conversations with an AI employee.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ScenarioCard
          scene={1}
          title="Negative Performance Review"
          imageUrl="/performanceReview.webp"
          description="An employee performance review meeting."
          level="Intern"
          cast={[
            { name: "You", role: "Manager" },
            { name: bart.name, role: bart.role.split(".")[0] },
          ]}
        />
        <ScenarioCard
          scene={2}
          title="Workplace Conflict"
          imageUrl="/workplaceConflict.jpg"
          description="A tense discussion between coworkers."
          level="Manager"
          locked
        />
        <ScenarioCard
          scene={3}
          title="Employee Layoff"
          imageUrl="/employeeLayoff.jpg"
          description="A manager informing an employee about layoffs."
          level="CEO"
          locked
        />
      </div>

      <div className="rise mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]" style={{ animationDelay: "380ms" }}>
        <ScoreCard />
        <div className="flex flex-col gap-4">
          <AchievementsCard />
          <ProgressCard />
        </div>
      </div>
    </main>
  );
}
