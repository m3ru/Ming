import React from "react";
import { Badge } from "./ui/badge";

export default function SentimentBar({
  label,
  sentiment,
}: {
  label: string;
  sentiment: number;
}) {
  const value = (sentiment + 1) / 2; // Normalize score from [-1, 1] to [0, 1]

  const descriptor = sentiment < 0 ? "negative" : "positive";

  const [displayValue, setDisplayValue] = React.useState(0.5);
  const [lastUpdateTime, setLastUpdateTime] = React.useState(Date.now());

  React.useEffect(() => {
    const interval = setInterval(() => {
      setDisplayValue((prev) => {
        const now = Date.now();
        // Calculate delta time
        const deltaTime = now - lastUpdateTime;
        console.log(deltaTime);
        setLastUpdateTime(now);

        const maxChange = (deltaTime / 1000) * 0.05; // Max change per 100ms

        if (Math.abs(value - prev) <= maxChange) {
          return value; // Close enough, snap to target
        }
        return prev + Math.sign(value - prev) * maxChange; // Move towards target
      });
    }, 10);
    return () => clearInterval(interval);
  }, [value]);

  return (
    <span
      // style={{
      //   backgroundColor: `color-mix(in srgb, red ${Math.round((1 - value) * 100)}%, lime ${Math.round(
      //     value * 100
      //   )}%)`,
      // }}
      className="w-full flex items-center justify-between overflow-x-clip transition-all duration-500 px-2"
    >
      <span>☹</span>
      {/* <Badge className="z-10 text-black bg-white pointer-events-none">
        You are {Math.abs(Math.round((value - 0.5) * 200))}% {descriptor}
      </Badge> */}
      <style>{`
        progress::-webkit-progress-value {
          border-color: color-mix(in srgb, red ${Math.round((1 - displayValue) * 100)}%, lime ${Math.round(
            displayValue * 100
          )}%);
        }

        progress::-moz-progress-bar {
          border-color: color-mix(in srgb, red ${Math.round((1 - displayValue) * 100)}%, lime ${Math.round(
            displayValue * 100
          )}%);
        }
      `}</style>
      <progress className="w-full" value={displayValue} max={1} />
      <span>☺</span>
    </span>
  );
}
