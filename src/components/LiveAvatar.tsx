"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleAlert } from "lucide-react";
import ScenarioVideo from "@/components/ScenarioVideo";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { LiveAvatarController, avatarTile } from "@/lib/liveAvatar";
import { Scenario } from "@/lib/types";

// Same speaking treatment as the standard tile, so the call screen reads the same.
const BARS = [0.55, 1, 0.7, 0.9];
const GLOW =
  "inset 0 0 0 3px var(--pencil), inset 0 0 48px color-mix(in srgb, var(--pencil) 35%, transparent)";
const NOTE_ACTION =
  "-my-2 min-h-11 shrink-0 cursor-pointer self-center rounded-lg px-2.5 font-semibold text-pencil transition-colors hover:bg-pencil/10";

/**
 * Bart as a live, lip-synced video driven by the call's own voice. A loading
 * screen shows while the call and video connect; the standard tile appears only
 * if the video cannot load, with a short note and a retry. Voice never depends
 * on the video.
 */
export default function LiveAvatar({ scenario }: { scenario: Scenario }) {
  const voice = useVoiceSession();
  const reduceMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [avatar] = useState(
    () => new LiveAvatarController({ baseURL: () => "/api/backend" }),
  );
  const { phase, failure, audible } = useSyncExternalStore(
    avatar.subscribe,
    avatar.getSnapshot,
    avatar.getSnapshot,
  );
  const name = scenario.npcs[0]?.name ?? "Bart";
  const { subscribeRemoteAudio, routeOutput, subscribeCensor, speaking, status, error } =
    voice;
  const inCall = status !== "idle";
  // The synced output trails the voice track; cue Bart when you can hear him.
  const bartSpeaking = audible ?? speaking;

  useEffect(() => {
    avatar.attach(videoRef.current!, audioRef.current!);
    // Browsers may hold media back until a gesture; any press resumes it.
    const resume = () => avatar.resume();
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("keydown", resume, true);
    return () => {
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
      avatar.detach();
    };
  }, [avatar]);

  useEffect(
    () =>
      avatar.bindVoice(
        subscribeRemoteAudio && routeOutput
          ? { subscribeRemoteAudio, routeOutput, subscribeCensor }
          : undefined,
      ),
    [avatar, subscribeRemoteAudio, routeOutput, subscribeCensor],
  );

  useEffect(() => avatar.setSpeaking(speaking), [avatar, speaking]);

  // Video follows the call: it opens with the call and closes when it ends, so
  // idle time is never billed. The deferral absorbs development double-mounts.
  useEffect(() => {
    if (!inCall) {
      avatar.disconnect();
      return;
    }
    const timer = setTimeout(() => void avatar.connect(), 0);
    return () => clearTimeout(timer);
  }, [avatar, inCall]);

  const live = phase === "live";
  const tile = avatarTile(phase, { status, error });
  const shown = tile === "video";

  // The frame is shown whole, so extend its plain backdrop (sampled along the
  // top edge) into the rest of the tile instead of cropping Bart larger.
  const [fill, setFill] = useState<string>();
  useEffect(() => {
    if (!shown) return;
    const video = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 18;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const sample = () => {
      if (!context || !video.videoWidth) return;
      try {
        context.drawImage(video, 0, 0, 32, 18);
        const { data } = context.getImageData(0, 0, 32, 1);
        const sum = [0, 0, 0];
        for (let x = 0; x < 32; x++)
          for (let channel = 0; channel < 3; channel++)
            sum[channel] += data[x * 4 + channel];
        setFill(`rgb(${sum.map((total) => Math.round(total / 32)).join(" ")})`);
      } catch {
        /* Keep the previous fill. */
      }
    };
    sample();
    const timer = setInterval(sample, 2000);
    return () => clearInterval(timer);
  }, [shown]);
  return (
    <div className="relative aspect-video shrink-0 overflow-hidden rounded-2xl bg-muted shadow-lg shadow-ink/10 lg:aspect-auto lg:min-h-0 lg:flex-1">
      {tile === "fallback" && (
        <div className="absolute inset-0 flex flex-col">
          <ScenarioVideo scenario={scenario} />
        </div>
      )}
      {shown && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-ink transition-colors duration-300"
          style={fill ? { backgroundColor: fill } : undefined}
        />
      )}
      {/* Transparent until its first frame, so the standard tile shows through.
          It is never hidden: frame callbacks drive start-up and stall checks.
          Full width and bottom-aligned, like a webcam shot, so Bart is never
          zoomed past the size the renderer framed him at; the top edge fades
          into the extended backdrop. In tall tiles it keeps 72% of the height
          by trimming the frame's sides, which are backdrop once he is centred. */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label={`${name}, live video`}
        className="absolute inset-x-0 bottom-0 aspect-video min-h-[72%] w-full object-cover transition-[filter] duration-300 ease-out"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, black 18%)",
          ...(phase === "stalled" && { filter: "blur(6px) saturate(0.6)" }),
        }}
      />
      <audio ref={audioRef} autoPlay className="hidden" />
      <AnimatePresence>
        {tile === "loading" && (
          <motion.div
            key="loading"
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center bg-paper"
            initial={false}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 50% 58%, color-mix(in srgb, var(--pencil) 14%, transparent), transparent 62%)",
              }}
            />
            {/* The same cut-out walk as the debrief screen: Bart is on his way in. */}
            <div aria-hidden="true" className="bart-rig relative">
              <span className="bart-rig-leg bart-rig-leg-back" />
              <span className="bart-rig-leg bart-rig-leg-front" />
              <span className="bart-rig-body" />
              <span className="bart-rig-ground" />
            </div>
            <p className="hand relative mt-2 -rotate-2 text-[28px] text-ink-soft">
              {name} is joining the call…
            </p>
            <span
              aria-hidden="true"
              className="relative mt-3 h-1 w-32 overflow-hidden rounded-full bg-rule"
            >
              <motion.span
                className="block h-full w-1/3 rounded-full bg-pencil"
                animate={reduceMotion ? undefined : { x: ["-100%", "300%"] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {live && (
          <motion.div
            key="reveal"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-muted"
            initial={{ opacity: reduceMotion ? 0 : 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {live && bartSpeaking && (
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
      <AnimatePresence>
        {phase === "stalled" && (
          <motion.p
            key="stalled"
            role="status"
            className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-ink shadow-md shadow-ink/10 backdrop-blur-sm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            Reconnecting video…
          </motion.p>
        )}
      </AnimatePresence>
      {phase === "failed" && inCall && (
        <div role="alert" className="alert-note absolute inset-x-3 top-3 z-10">
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-red-pencil"
          />
          <p className="min-w-0 flex-1">
            {failure === "drop"
              ? `Live video dropped, but ${name}'s voice continues.`
              : `Live video didn't start, but ${name}'s voice continues.`}
          </p>
          <button type="button" onClick={avatar.retry} className={NOTE_ACTION}>
            Retry video
          </button>
        </div>
      )}
    </div>
  );
}
