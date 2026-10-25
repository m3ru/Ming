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

  return (
    <div className="w-full flex flex-col items-center">
      <div
        className="w-full h-10 relative overflow-hidden justify-center"
        style={{
          backgroundColor: "black",
        }}
      >
        {/* The color bar, which changes width based on sentiment */}
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${displayValue * 100}%`,
            backgroundColor: `hsl(${displayValue * 120} 75% 45%)`,
          }}
        />
        {/* The moving white cursor */}
        <div
          className="absolute h-full aspect-square bg-white shadow-lg transition-all duration-500 ease-out z-20"
          style={{
            left: `calc(${displayValue * 100}% - 1rem)`,
          }}
        />
        {/* The emojis on the ends of the bar */}
        <span className="absolute my-0.3 text-white text-3xl font-extrabold left-2 top-1/2 -translate-y-1/2 z-30">
          ☹
        </span>
        <span className="absolute my-0.3 text-white text-3xl font-extrabold right-2 top-1/2 -translate-y-1/2 z-30">
          ☺
        </span>

        {/* The "Mood" text, centered over the bar */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-40 text-white font-medium"></div>
      </div>
    </div>
  );
}
