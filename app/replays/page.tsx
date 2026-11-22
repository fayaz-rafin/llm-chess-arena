"use client";

import { useRouter } from "next/navigation";
import ArenaBackground from "@/app/components/ArenaBackground";

export default function ReplaysPage() {
  const router = useRouter();

  return (
    <div className="relative h-screen overflow-y-auto bg-[var(--ink)] text-[var(--ivory)]">
      <ArenaBackground />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[5]"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 40%, transparent 45%, rgba(13,11,9,0.7) 100%)",
        }}
      />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-12">
        <div className="rise-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">The Archive</p>
            <h1 className="panel-title mt-1 text-4xl text-[var(--ivory)]">Replays</h1>
          </div>
          <button
            onClick={() => router.push("/")}
            className="btn btn-ghost"
            aria-label="Back to the arena"
          >
            Back to Arena
          </button>
        </div>

        <div
          className="panel rise-in mt-16 flex flex-1 flex-col items-center justify-center rounded-2xl px-8 py-16 text-center"
          style={{ animationDelay: "0.1s" }}
        >
          <span className="rounded-full border border-[rgba(217,164,65,0.45)] bg-[rgba(217,164,65,0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--brass-bright)]">
            Coming soon
          </span>
          <h2 className="panel-title mt-6 text-3xl text-[var(--ivory)] sm:text-4xl">
            Match replays are on the way
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--ivory-dim)]">
            Soon you&apos;ll be able to browse finished battles and watch them play back on
            the 3D board. For now, start a match in the arena.
          </p>
          <button
            onClick={() => router.push("/")}
            className="btn btn-primary mt-8"
            aria-label="Return to the arena"
          >
            Back to Arena
          </button>
        </div>
      </div>
    </div>
  );
}
