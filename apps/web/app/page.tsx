import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[color:rgba(251,243,208,0.75)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl tracking-tight">Anonymous Panel</span>
            <span className="hidden text-sm text-[var(--muted)] sm:inline">
              Market Research • Privacy by Design
            </span>
          </div>

          <nav className="flex items-center gap-6 text-sm">
            <Link className="hover:underline" href="/participate">
              Participate
            </Link>
            <Link className="hover:underline" href="/dashboard">
              Researcher
            </Link>
            <a className="hidden hover:underline sm:inline" href="#info">
              Info
            </a>
            <a className="hidden hover:underline sm:inline" href="#fees">
              Fees
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20 pt-10">
        <section className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:gap-10">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-2)] p-7 shadow-[var(--shadow)] sm:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs">
                Zero-knowledge age proof
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs">
                No PII stored
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs">
                Differential privacy analytics
              </span>
            </div>

            <h1 className="mt-6 font-display text-4xl leading-[1.05] tracking-tight sm:text-6xl">
              Paid studies,
              <br />
              with anonymity you can trust.
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
              Join research studies without giving away your identity. We verify 18+ eligibility
              using zero-knowledge proofs, so you can participate without revealing your birth date.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/participate"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)]"
              >
                Browse Studies
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white/60 px-6 py-3 text-sm font-semibold hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--paper)]"
              >
                Researcher Login
              </Link>
              <span className="text-xs text-[var(--muted)] sm:ml-2">
                Typical setup time: ~1 minute
              </span>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] bg-white/55 p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Proofs</div>
                <div className="mt-1 font-semibold">18+ without birth date</div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Eligibility is proven locally; only a cryptographic proof is shared.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white/55 p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Privacy</div>
                <div className="mt-1 font-semibold">No identity fields</div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  We don’t ask for name or email, and we avoid storing IP addresses.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white/55 p-4">
                <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Analytics</div>
                <div className="mt-1 font-semibold">Privacy-preserving results</div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Aggregates can be computed with differential privacy guarantees.
                </p>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div
              id="info"
              className="rounded-2xl border border-[var(--line)] bg-white/55 p-6 shadow-[var(--shadow)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl tracking-tight">Visitor info</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    A concise, museum-style guide for first-time participants and researchers.
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full border border-[var(--line)] bg-[var(--paper-2)]" />
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
                  <dt className="text-[var(--muted)]">Opening hours</dt>
                  <dd className="font-medium">Any time, self-serve</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
                  <dt className="text-[var(--muted)]">Time required</dt>
                  <dd className="font-medium">~5–15 minutes</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[var(--muted)]">Accessibility</dt>
                  <dd className="font-medium">Keyboard-friendly forms</dd>
                </div>
              </dl>
            </div>

            <div
              id="fees"
              className="rounded-2xl border border-[var(--line)] bg-white/55 p-6 shadow-[var(--shadow)]"
            >
              <h2 className="font-display text-2xl tracking-tight">Fees & payouts</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                No membership fee. Researchers fund studies; participants earn per completion.
              </p>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-4">
                  <div>
                    <div className="text-sm font-semibold">Participant payout</div>
                    <div className="text-xs text-[var(--muted)]">Typical study reward</div>
                  </div>
                  <div className="font-display text-2xl tracking-tight">$5–$25</div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--paper-2)] p-4">
                  <div>
                    <div className="text-sm font-semibold">Researcher pricing</div>
                    <div className="text-xs text-[var(--muted)]">Per response (example)</div>
                  </div>
                  <div className="font-display text-2xl tracking-tight">$8+</div>
                </div>
              </div>

              <div className="mt-5">
                <Link className="text-sm font-semibold text-[var(--accent)] hover:underline" href="/dashboard">
                  Create a study →
                </Link>
              </div>
            </div>
          </aside>
        </section>

        <section className="mt-12 border-t border-[var(--line)] pt-10">
          <div className="grid gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="font-display text-3xl tracking-tight">
                Built for sensitive research.
              </h2>
              <p className="mt-3 max-w-2xl text-[var(--muted)]">
                We’re optimizing for privacy-first participation. If you’re collecting potentially
                sensitive opinions, you should not need personal identifiers to get quality data.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/55 p-6 shadow-[var(--shadow)]">
              <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Important note</div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                Don’t purchase “identity” from third parties. Our design avoids linking responses to
                real-world identities by default.
              </p>
              <div className="mt-4 h-px bg-[var(--line)]" />
              <p className="mt-4 text-sm">
                <a className="font-semibold hover:underline" href="#info">
                  Read visitor info
                </a>
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-14 border-t border-[var(--line)] pt-8 text-sm text-[var(--muted)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} Anonymous Panel</p>
            <div className="flex gap-5">
              <Link className="hover:underline" href="/participate">
                Participate
              </Link>
              <Link className="hover:underline" href="/dashboard">
                Researcher
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
