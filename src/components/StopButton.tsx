import { Button } from "@/components/ui/button";
import { useCallback } from "react";

interface StopButtonProps {
  onStop: () => void;
}

export default function StopButton({ onStop }: StopButtonProps) {
  return (
    <Button
      variant="destructive"
      className="bg-red-200 text-red-800 hover:bg-red-300 border border-red-300"
      onClick={onStop}
    >
      Stop
    </Button>
  );
}
