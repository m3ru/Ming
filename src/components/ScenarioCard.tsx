"use client";
import { Lock, Play, User } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

type Level = "Intern" | "Manager" | "CEO";

// Chip text is darkened toward black so the small label keeps 4.5:1 on its tint.
const levelChip: Record<Level, string> = {
  Intern: "bg-sage/15 text-[color-mix(in_srgb,var(--sage),black_25%)]",
  Manager: "bg-pencil/10 text-[color-mix(in_srgb,var(--pencil),black_25%)]",
  CEO: "bg-red-pencil/10 text-[color-mix(in_srgb,var(--red-pencil),black_25%)]",
};

export default function ScenarioCard({
  scene,
  imageUrl,
  title,
  description,
  level,
  cast,
  locked = false,
}: {
  scene: number;
  imageUrl: string;
  title: string;
  description: string;
  level: Level;
  cast?: { name: string; role: string }[];
  locked?: boolean;
}) {
  return (
    <div
      role={locked ? "group" : undefined}
      aria-disabled={locked || undefined}
      className={`relative flex h-full flex-col rounded-xl border border-rule bg-white p-5 transition-colors ${
        locked ? "" : "hover:border-pencil/60 focus-within:border-pencil/60"
      }`}
    >
      <p className="text-sm font-medium text-ink-soft">Scene {scene}</p>
      <h2 className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-ink">
        {title}
      </h2>
      <span
        className={`mt-2 w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${levelChip[level]}`}
      >
        {level}
      </span>

      <div className="relative mt-4 aspect-[16/10] w-full overflow-hidden rounded-lg bg-muted">
        <Image
          src={imageUrl}
          alt={description || title}
          fill
          sizes="(max-width: 1023px) 100vw, 33vw"
          className="object-cover"
        />
        {locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/75 text-white">
            <Lock aria-hidden className="size-7" />
            <p className="text-lg font-bold">Locked</p>
            <p className="text-sm">Coming soon</p>
          </div>
        )}
      </div>

      {locked ? (
        <p className="mt-4 text-sm text-ink-soft">{description}</p>
      ) : (
        <>
          {cast && cast.length > 0 && (
            <div className="mb-5 mt-4">
              <h3 className="text-sm font-semibold text-ink-soft">Cast</h3>
              <ul className="mt-2 space-y-2">
                {cast.map(({ name, role }) => (
                  <li key={name} className="flex items-start gap-2">
                    <User aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-soft" />
                    <span className="min-w-0 text-sm">
                      <span className="block font-semibold text-ink">{name}</span>
                      <span className="block text-ink-soft">{role}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The link's ::after stretches over the card, so the whole card starts the scene. */}
          <Link
            href="/scenario"
            className="mt-auto inline-flex w-fit items-center gap-2 rounded-lg bg-pencil px-4 py-2 text-sm font-semibold text-white after:absolute after:inset-0 after:rounded-xl hover:bg-pencil/90"
          >
            <Play aria-hidden className="size-4 fill-current" />
            Start scene
          </Link>
        </>
      )}
    </div>
  );
}
