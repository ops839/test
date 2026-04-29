export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-bm-border bg-bm-panel">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-xl font-semibold text-bm-text">
            Full Backfill
          </h1>
          <p className="text-sm text-bm-muted">
            Sybill + Slack &rarr; Airtable, in one run.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <section className="rounded-xl border border-bm-border bg-bm-panel p-8 text-center space-y-2">
            <h2 className="text-lg font-medium text-bm-text">Coming online</h2>
            <p className="text-sm text-bm-muted">
              The merged backfill tool is being built out in phases. Check back
              soon.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-bm-border bg-bm-panel">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-bm-muted">
          Blu Mountain RevOps &middot; Browser-only
        </div>
      </footer>
    </div>
  );
}
