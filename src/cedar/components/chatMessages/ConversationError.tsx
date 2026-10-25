export function ConversationError() {
  return (
    <div
      role="alert"
      className="w-full rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900"
    >
      <p className="font-medium">The AI could not finish its response.</p>
      <p className="mt-1">
        Your conversation is still available. You can try sending your message
        again from the message box.
      </p>
    </div>
  );
}
