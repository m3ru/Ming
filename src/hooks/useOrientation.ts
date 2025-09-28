import { useEffect, useState } from "react";

export default function useOrientation(): "portrait" | "landscape" {
  const [orientation, setOrientation] = useState<"landscape" | "portrait">(
    "landscape"
  );

  useEffect(() => {
    const updateOrientation = () => {
      if (window.innerWidth > window.innerHeight) {
        setOrientation("landscape");
      } else {
        setOrientation("portrait");
      }
    };

    window.addEventListener("resize", updateOrientation);
    updateOrientation(); // Call on mount

    return () => {
      window.removeEventListener("resize", updateOrientation);
    };
  }, []);

  return orientation;
}
