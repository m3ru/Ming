import { CircleAlert } from "lucide-react";

export function ConversationError() {
  return (
    <div role="alert" className="alert-note w-full">
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-red-pencil"
      />
      <p>This reply didn&apos;t finish. Send your message again.</p>
    </div>
  );
}
