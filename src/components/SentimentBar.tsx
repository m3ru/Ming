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

  return (
    <span
      style={{
        backgroundColor: `color-mix(in srgb, red ${Math.round((1 - value) * 100)}%, lime ${Math.round(
          value * 100
        )}%)`,
      }}
      className="w-full flex items-center justify-center overflow-x-clip transition-all duration-500 py-1"
    >
      <Badge className="z-10 text-black bg-white">
        You are {Math.abs(Math.round((value - 0.5) * 200))}% {descriptor}
      </Badge>
    </span>
  );
}
