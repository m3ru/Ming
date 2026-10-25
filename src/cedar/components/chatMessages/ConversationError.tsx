export function ConversationError() {
  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-red-pencil/30 bg-red-pencil/5 p-3 text-sm text-ink"
    >
      <p className="font-semibold text-red-pencil">
        The AI could not finish its response.
      </p>
      <p className="mt-1">
        Your conversation is still available. You can try sending your message
        again from the message box.
      </p>
    </div>
  );
}
