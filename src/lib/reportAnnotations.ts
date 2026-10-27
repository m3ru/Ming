export type AnnotationSegment = {
  title: string;
  content: string;
  highlights: {
    start: number;
    end: number;
    color: "red" | "yellow" | "green";
    feedback: string;
  }[];
};

/** Validate stored/provider locations before slicing source text for display. */
export function parseAnnotationSegments(
  value: unknown,
  transcript: string | null,
): AnnotationSegment[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 4 ||
    !transcript
  )
    return;
  const segments: AnnotationSegment[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 100 ||
      typeof item.content !== "string" ||
      !item.content ||
      !Array.isArray(item.highlights) ||
      item.highlights.length > 3
    )
      return;
    let end = 0;
    for (const highlight of item.highlights) {
      if (
        !highlight ||
        typeof highlight !== "object" ||
        !Number.isInteger(highlight.start) ||
        !Number.isInteger(highlight.end) ||
        highlight.start < end ||
        highlight.end <= highlight.start ||
        highlight.end > item.content.length ||
        !["red", "yellow", "green"].includes(highlight.color) ||
        typeof highlight.feedback !== "string" ||
        !highlight.feedback.trim() ||
        highlight.feedback.length > 160
      )
        return;
      end = highlight.end;
    }
    segments.push(item);
  }
  if (segments.map((segment) => segment.content).join("\n") !== transcript)
    return;
  return segments;
}
