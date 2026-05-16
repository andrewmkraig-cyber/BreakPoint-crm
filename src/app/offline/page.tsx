export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-court-surface px-6 py-6">
      <p className="max-w-md text-center text-base text-court-fg">
        You&apos;re offline. Ace will reconnect when your network is back.
      </p>
    </div>
  );
}
