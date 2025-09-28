import { Badge } from "./ui/badge";

export default function SentimentBar({
  label,
  sentiment,
}: {
  label: string;
  sentiment: number;
}) {
  const value = (sentiment + 1) / 2; // Normalize score from [-1, 1] to [0, 1]

  return (
    <span className="w-full flex items-center justify-center overflow-x-clip">
      <Badge className="z-10 text-black bg-white">
        {label} - {Math.round(value * 100)}% positive
      </Badge>

      {/* Background bar */}
      <span
        style={{
          width: `100%`,
          height: "26px",
          backgroundColor: `color-mix(in srgb, red ${Math.round((1 - value) * 100)}%, lime)`,
          maxWidth: "52%",
        }}
        className="transition-all duration-500 fixed max-w-full"
      />
    </span>
  );
}
