import { scenarioSchema } from "./scenarioSchema";
import type { Scenario } from "./types";

const ACTIVE_SCENARIO_KEY = "activeScenario";
type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Only the active practice selection is session-scoped; saved reports stay intact. */
export function readActiveScenario(storage?: SessionStorage): Scenario | undefined {
  let raw: string | null;
  try {
    raw = (storage ?? window.sessionStorage).getItem(ACTIVE_SCENARIO_KEY);
  } catch {
    throw new Error("Browser storage is unavailable. Allow session storage and try again.");
  }
  if (raw === null) return undefined;
  try {
    return scenarioSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("The selected scenario could not be loaded. Start a new session to return to Bart.");
  }
}

type SessionStarterOptions = {
  isProcessing: () => boolean;
  stopVoice: () => Promise<unknown>;
  storage: () => SessionStorage;
  navigate: (path: string) => void;
  onStarting: (starting: boolean) => void;
  onError: (message: string | null) => void;
};

/** Serialize the handoff and keep the current page alive if a voice save fails. */
export function createSessionStarter(options: SessionStarterOptions) {
  let pending: Promise<void> | undefined;
  return (scenario?: Scenario): Promise<void> => {
    if (pending) return pending;
    options.onStarting(true);
    options.onError(null);
    pending = Promise.resolve().then(async () => {
      const selection = scenario === undefined ? undefined : scenarioSchema.safeParse(scenario);
      if (selection && !selection.success) {
        throw new Error("This scenario could not be started. Generate a new follow-up and try again.");
      }
      if (options.isProcessing()) {
        throw new Error("Wait for the current reply to finish, then start a new session.");
      }
      try {
        await options.stopVoice();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "The voice recording could not be saved.";
        throw new Error(`${detail} Your current session is still open. Retry New session, or choose Continue by text before trying again.`);
      }
      // A typed turn may have started while the last voice turn was saving.
      if (options.isProcessing()) {
        throw new Error("Wait for the current reply to finish, then start a new session.");
      }
      try {
        const storage = options.storage();
        if (selection?.success) storage.setItem(ACTIVE_SCENARIO_KEY, JSON.stringify(selection.data));
        else storage.removeItem(ACTIVE_SCENARIO_KEY);
      } catch {
        throw new Error("Could not save the next session in browser storage. Allow session storage and retry New session.");
      }
      // A document navigation remounts Cedar with a fresh UUID and conversation.
      options.navigate("/scenario");
    }).catch((error: unknown) => {
      pending = undefined;
      options.onStarting(false);
      options.onError(error instanceof Error ? error.message : "Could not start a new session. Please try again.");
      throw error;
    });
    // Keep the success latch until the document unloads, including rapid clicks
    // between assigning the URL and the browser beginning navigation.
    return pending;
  };
}
