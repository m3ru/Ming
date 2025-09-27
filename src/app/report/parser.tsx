"use client"
// parser-frontend.ts
export default async function Parser(filePath = "/output") {
  try {
    const res = await fetch(filePath);
    if (!res.ok) {
      console.error(`Parser: fetch ${filePath} returned ${res.status} ${res.statusText}`);
      throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
    }
    return parseTextToJSON(await res.text());
  } catch (err) {
    console.error('Parser: error fetching/parsing output file', err);
    throw err;
  }
}

function parseTextToJSON(text: string) {
  const result: any = {};

  // -----------------------
  // 1) CONFIG block (prefer the specific "AI tracing exporter initialized { ... }")
  // -----------------------
  let configMatch = text.match(/AI tracing exporter initialized\s*\{([\s\S]*?)\}/i);
  if (!configMatch) {
    // fallback to first {...} block
    configMatch = text.match(/\{([\s\S]*?)\}/);
  }

  if (configMatch) {
    const body = configMatch[1];
    const obj: Record<string, any> = {};

    // parse line-by-line to tolerate empty strings and trailing commas
    const lines = body.split("\n");
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // match `key: value` with optional trailing comma
      const m = line.match(/^([A-Za-z0-9_$-]+)\s*:\s*(.*?)(?:,)?$/);
      if (!m) continue;
      const key = m[1];
      let val: any = m[2].trim();

      // normalize value
      if (/^['"].*['"]$/.test(val)) {
        // quoted string (allow empty quotes)
        val = val.slice(1, -1);
      } else if (/^(true|false)$/i.test(val)) {
        val = val.toLowerCase() === "true";
      } else if (val === "") {
        val = "";
      } else if (!Number.isNaN(Number(val))) {
        val = Number(val);
      } else {
        // fallback to raw trimmed string
        val = val.replace(/,$/, "").trim();
      }
      obj[key] = val;
    }

    result.config = obj;
  } else {
    result.config = null;
  }

  // -----------------------
  // 2) SEGMENTS
  // Use a forgiving closing tag matcher: </segment:[anything]>
  // -----------------------
  result.segments = [];
  const segRegex = /<segment:\s*([^>]+)>\s*([\s\S]*?)\s*<\/segment:[^>]*>/gi;
  // only consider segments that appear after the "## DETAILED ANALYSIS" heading
  const detailedHeadingRegex = /##\s*DETAILED ANALYSIS/i;
  const dhMatch = detailedHeadingRegex.exec(text);
  const segmentSource = dhMatch ? text.slice(dhMatch.index) : text;

  let segMatch;
  while ((segMatch = segRegex.exec(segmentSource)) !== null) {
    result.segments.push({
      title: segMatch[1].trim(),
      content: segMatch[2].trim(),
    });
  }

  // -----------------------
  // 3) Named tags: <strength>, <weakness>, <analysis>
  // -----------------------
  function extractTag(tag: string) {
    const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : null;
  }
  result.strength = extractTag("strength");
  result.weakness = extractTag("weakness");
  result.analysis = extractTag("analysis");

  // -----------------------
  // 4) Markdown-style sections (optional)
  // CONVERSATION OVERVIEW and USER PERFORMANCE ANALYSIS
  // -----------------------
  const convMatch = text.match(/##\s*CONVERSATION OVERVIEW\s*([\s\S]*?)\n##\s*USER PERFORMANCE ANALYSIS/i);
  result.summary = convMatch ? convMatch[1].trim() : null;

    const userPerfMatch = text.match(/##\s*USER PERFORMANCE ANALYSIS\s*([\s\S]*?)\s*##\s*IMPROVEMENT RECOMMENDATIONS/i);
    result.feedback = userPerfMatch ? userPerfMatch[1].trim() : null;  result.feedback = userPerfMatch ? userPerfMatch[1].trim() : null;

  const detailedMatch = text.match(/Detailed Analysis:\s*([\s\S]*?)(?=\n<segment:|$)/i);
  result.detailedAnalysis = detailedMatch ? detailedMatch[1].trim() : null;

  return result;
}