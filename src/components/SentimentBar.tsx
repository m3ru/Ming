import React from "react";

export default function SentimentBar({ sentiment }: { sentiment: number }) {
  const value = (sentiment + 1) / 2; // Normalize score from [-1, 1] to [0, 1]

  const [displayValue, setDisplayValue] = React.useState(0.5);

  React.useEffect(() => {
    let lastUpdateTime = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const deltaTime = now - lastUpdateTime;
      lastUpdateTime = now;
      setDisplayValue((prev) => {
        const maxChange = (deltaTime / 1000) * 0.05; // Move 5% of the bar per second

        if (Math.abs(value - prev) <= maxChange) {
          return value; // Close enough, snap to target
        }
        return prev + Math.sign(value - prev) * maxChange; // Move towards target
      });
    }, 10);
    return () => clearInterval(interval);
  }, [value]);

  // A note only while the needle is still travelling to the latest score.
  const note =
    value > displayValue
      ? "warming up"
      : value < displayValue
        ? "cooling off"
        : null;
  // Keep the last words on screen while the note fades out.
  const shownNote = React.useRef(note);
  if (note) shownNote.current = note;
  // Keep the note on the side of the needle with more room.
  const noteSide =
    displayValue < 0.5 ? "left-full ml-3 -rotate-3" : "right-0 mr-3 rotate-3";

  return (
    <section
      aria-label="Your tone"
      className="shrink-0 rounded-xl border border-rule bg-white px-5 pb-4 pt-4"
    >
      {/* One grid so the needle layer can share the track's cell. */}
      <div className="grid grid-cols-1">
        <div
          className="relative z-10 col-start-1 row-start-2 justify-self-start"
          style={{ width: `${displayValue * 100}%` }}
        >
          <span
            aria-hidden="true"
            className="absolute right-0 top-1/2 size-5 -translate-y-1/2 translate-x-1/2 rounded-full border-[3px] border-ink bg-white shadow-sm"
          />
          {/* Written in left to right, then faded out before the clip resets. */}
          <span
            aria-hidden={!note}
            className={`hand absolute bottom-full mb-2 whitespace-nowrap text-[27px] ${noteSide} ${
              shownNote.current === "warming up" ? "text-pencil" : "text-red-pencil"
            }`}
            style={
              note
                ? {
                    opacity: 1,
                    clipPath: "inset(-0.5em -0.5em -0.5em -0.25em)",
                    transition:
                      "opacity 150ms ease-out, clip-path 450ms ease-out",
                  }
                : {
                    opacity: 0,
                    clipPath: "inset(-0.5em 100% -0.5em -0.25em)",
                    transition: "opacity 300ms ease-out, clip-path 0s 300ms",
                  }
            }
          >
            {shownNote.current}
          </span>
        </div>
        <h2 className="col-start-1 row-start-1 mb-10 text-base font-bold text-ink">
          Your tone
        </h2>
        <div
          role="meter"
          aria-label="Your tone, from tense to warm"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(displayValue * 100)}
          className="col-start-1 row-start-2 h-3 rounded-full bg-linear-to-r from-tense to-warm"
        />
        <div className="col-start-1 row-start-3 mt-3 flex justify-between text-sm text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-tense" />
            Tense
          </span>
          <span className="flex items-center gap-1.5">
            Warm
            <span aria-hidden="true" className="size-2 rounded-full bg-warm" />
          </span>
        </div>
      </div>
    </section>
  );
}
