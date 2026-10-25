import { z } from "zod";

export const annotationPlanSchema = z.object({
  segments: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        startLine: z.number().int().nonnegative(),
        highlights: z
          .array(
            z.object({
              line: z.number().int().nonnegative(),
              quote: z.string().min(1).max(500),
              occurrence: z.number().int().nonnegative(),
              color: z.enum(["red", "yellow", "green"]),
              feedback: z.string().trim().min(1).max(160),
            }),
          )
          .max(3),
      }),
    )
    .min(1)
    .max(4),
});

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

/** Model selects locations only. All displayed speech comes from the source. */
export function buildAnnotationSegments(
  transcript: string,
  value: unknown,
  onRejectedHighlight?: () => void,
): AnnotationSegment[] {
  const plan = annotationPlanSchema.parse(value);
  const lines = transcript.split("\n");
  return plan.segments.map((segment, index) => {
    const end = plan.segments[index + 1]?.startLine ?? lines.length;
    if (
      (index === 0 && segment.startLine !== 0) ||
      end <= segment.startLine ||
      end > lines.length
    )
      throw new Error("Invalid segment boundary.");
    const content = lines.slice(segment.startLine, end).join("\n");
    const highlights = segment.highlights
      .map((highlight) => {
        const matches: { line: number; position: number }[] = [];
        for (let lineIndex = segment.startLine; lineIndex < end; lineIndex++) {
          const source = lines[lineIndex];
          if (!/^user:/i.test(source)) continue;
          let position = source.indexOf(
            highlight.quote,
            source.indexOf(":") + 1,
          );
          let occurrence = 0;
          while (position >= 0) {
            const match = { line: lineIndex, position };
            // Prefer a valid explicit location, including repeated quotes.
            if (
              lineIndex === highlight.line &&
              occurrence === highlight.occurrence
            ) {
              return {
                ...sourceHighlight(match),
                color: highlight.color,
                feedback: highlight.feedback,
              };
            }
            matches.push(match);
            occurrence++;
            position = source.indexOf(highlight.quote, position + 1);
          }
        }
        // Models sometimes count numbered lines incorrectly. A unique exact
        // match in this segment's user speech is still an authoritative span.
        // Never guess between repeated quotes, cross segments, or use Bart's text.
        if (matches.length !== 1) {
          onRejectedHighlight?.();
          return null;
        }
        return {
          ...sourceHighlight(matches[0]),
          color: highlight.color,
          feedback: highlight.feedback,
        };

        function sourceHighlight(match: { line: number; position: number }) {
          const offset = lines
            .slice(segment.startLine, match.line)
            .reduce((sum, item) => sum + item.length + 1, 0);
          const start = offset + match.position;
          return { start, end: start + highlight.quote.length };
        }
      })
      .filter(
        (highlight): highlight is NonNullable<typeof highlight> =>
          highlight !== null,
      )
      .sort((a, b) => a.start - b.start);
    if (
      highlights.some(
        (highlight, i) => i > 0 && highlight.start < highlights[i - 1].end,
      )
    )
      throw new Error("Overlapping highlights.");
    return { title: segment.title, content, highlights };
  });
}
