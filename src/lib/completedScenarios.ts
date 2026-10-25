const KEY = "ming:completed-scenarios:v1";
type StorageReader = Pick<Storage, "getItem">;

export function readCompletedScenarioIds(storage: StorageReader): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function recordCompletedScenario(storage: StorageReader & Pick<Storage, "setItem">, sessionId: string): void {
  if (!sessionId) throw new Error("A completed session needs an ID.");
  storage.setItem(KEY, JSON.stringify([...new Set([...readCompletedScenarioIds(storage), sessionId])]));
}
