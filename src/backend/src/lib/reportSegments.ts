/**
 * Reads tagged segments from reports saved before structured annotations (annotationSegments).
 * Any letter case and any or no closing title; a segment whose closing tag is missing ends
 * where the next one starts. Empty segments are skipped.
 */
export function reportSegments(text: string) {
  const segments: { title: string; content: string }[] = [];
  for (const [, title, content] of text.matchAll(
    /<segment:\s*([^>]+?)\s*>([\s\S]*?)(?:<\/segment(?::[^>]*)?>|(?=<segment:))/gi,
  ))
    if (title.trim() && content.trim()) segments.push({ title, content: content.trim() });
  return segments;
}
