"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { Scenario } from "@/lib/types";

// Equaliser bar peaks; state-driven motion, not real audio levels.
const BARS = [0.55, 1, 0.7, 0.9];
const GLOW =
  "inset 0 0 0 3px var(--pencil), inset 0 0 48px color-mix(in srgb, var(--pencil) 35%, transparent)";

export default function ScenarioVideo({ scenario }: { scenario: Scenario }) {
  const { speaking } = useVoiceSession();
  const reduceMotion = useReducedMotion();
  const name = scenario.npcs[0]?.name ?? "Bart";
  return (
    <div className="relative aspect-video shrink-0 overflow-hidden rounded-2xl bg-muted shadow-lg shadow-ink/10 lg:aspect-auto lg:min-h-0 lg:flex-1">
      <video
        loop
        autoPlay
        muted
        playsInline
        aria-label={`${scenario.title} character video`}
        className="absolute inset-0 size-full object-cover"
      >
        <source src="/BillyLoop.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <AnimatePresence>
        {speaking && (
          <motion.div
            key="speaking"
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 rounded-2xl"
              style={{ boxShadow: GLOW }}
              animate={reduceMotion ? undefined : { opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.p
              className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-white/90 py-1.5 pl-3 pr-3.5 text-sm font-semibold text-ink shadow-md shadow-ink/10 backdrop-blur-sm"
              initial={{ y: 8, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 8, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 480, damping: 32 }}
            >
              <span aria-hidden="true" className="flex h-3.5 items-center gap-[3px]">
                {BARS.map((peak, index) => (
                  <motion.span
                    key={index}
                    className="h-full w-[3px] rounded-full bg-pencil"
                    style={{ scaleY: 0.35 }}
                    animate={
                      reduceMotion ? undefined : { scaleY: [0.35, peak, 0.35] }
                    }
                    transition={{
                      duration: 0.6 + index * 0.12,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: index * 0.08,
                    }}
                  />
                ))}
              </span>
              {name} is speaking
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
