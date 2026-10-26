export type TranscriptFragment = {
  event_id: string;
  role: "user" | "assistant";
  delta: string;
  start_ms: number;
  end_ms: number;
};
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

// Group each speaker in stable five-second display windows. These are not
// speech turns. Stable IDs let late captions update persisted bubbles safely.
export class VoiceTranscript {
  private fragments = new Map<string, TranscriptFragment>();
  constructor(
    private sessionId: string,
    private startedAt: number,
  ) {}

  append(fragment: TranscriptFragment) {
    if (this.fragments.has(fragment.event_id)) return false;
    this.fragments.set(fragment.event_id, fragment);
    return true;
  }

  messages() {
    const groups: Array<
      ConversationMessage & { metadata: Record<string, unknown> }
    > = [];
    for (const role of ["user", "assistant"] as const) {
      const fragments = [...this.fragments.values()]
        .filter((part) => part.role === role)
        .sort(
          (a, b) =>
            a.start_ms - b.start_ms ||
            a.end_ms - b.end_ms ||
            a.event_id.localeCompare(b.event_id),
        );
      let group: (typeof groups)[number] | undefined;
      let window = -1;
      for (const fragment of fragments) {
        const nextWindow = Math.floor(fragment.start_ms / 5000);
        if (!group || nextWindow !== window) {
          window = nextWindow;
          group = {
            id: "voice-" + this.sessionId + "-" + role + "-" + window,
            role,
            content: "",
            createdAt: new Date(
              this.startedAt + fragment.start_ms,
            ).toISOString(),
            // Fragments stay in this.fragments: copying them into every saved message
            // overran the gateway's 4,096-value JSON budget after a few minutes of talk.
            metadata: {
              source: "live-voice",
              sessionId: this.sessionId,
              fragments: [],
            },
          };
          groups.push(group);
        }
        group.content += fragment.delta;
      }
    }
    return groups.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

// Live context appends allow 500 tokens. UTF-8 byte limits conservatively
// bound that without adding a tokenizer to the browser bundle.
export function voiceContextChunks(text: string) {
  const chunks: string[] = [];
  let chunk = "",
    bytes = 0;
  const encoder = new TextEncoder();
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > 450) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
