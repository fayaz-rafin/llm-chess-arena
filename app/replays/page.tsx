"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ArenaBackground from "@/app/components/ArenaBackground";

type ReplaySummary = {
  id: string;
  clientMatchId: string;
  startedAt: string;
  endedAt: string;
  winner: "white" | "black";
  turns: number;
  whiteModel: string;
  blackModel: string;
};

type ReplayDetail = ReplaySummary & {
  replayText: string;
  replayJson: unknown;
};

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const readJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 120);
    throw new Error(
      `Unexpected response (${response.status}): ${preview || "non-JSON"}`
    );
  }
};

export default function ReplaysPage() {
  const router = useRouter();
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReplay, setSelectedReplay] = useState<ReplayDetail | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingReplay, setIsLoadingReplay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoadingList(true);
      setError(null);
      try {
        const response = await fetch("/api/replays?limit=50");
        const payload = await readJson<{
          replays?: ReplaySummary[];
          error?: string;
        }>(response);
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load replays");
        }
        setReplays(payload.replays ?? []);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load replays";
        setError(message);
      } finally {
        setIsLoadingList(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedReplay(null);
      return;
    }
    const loadReplay = async () => {
      setIsLoadingReplay(true);
      setError(null);
      try {
        const response = await fetch(`/api/replays/${selectedId}`);
        const payload = await readJson<{
          replay?: ReplayDetail;
          error?: string;
        }>(response);
        if (!response.ok || !payload.replay) {
          throw new Error(payload.error || "Replay not found");
        }
        setSelectedReplay(payload.replay);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load replay";
        setError(message);
      } finally {
        setIsLoadingReplay(false);
      }
    };
    void loadReplay();
  }, [selectedId]);

  const hasReplays = replays.length > 0;
  const selectedSummary = useMemo(
    () => replays.find((replay) => replay.id === selectedId) ?? null,
    [replays, selectedId]
  );

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
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="rise-in flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">The Archive</p>
            <h1 className="panel-title mt-1 text-4xl text-[var(--ivory)]">Replays</h1>
            <p className="mt-2 text-sm text-[var(--ivory-dim)]">
              Browse completed matches and replay them on the live arena.
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="btn btn-ghost"
            aria-label="Back to the arena"
          >
            Back to Arena
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-[rgba(176,72,60,0.4)] bg-[rgba(176,72,60,0.12)] p-3 text-sm text-[#e8a79e]">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="panel rise-in rounded-2xl p-4" style={{ animationDelay: "0.08s" }}>
            <div className="flex items-center justify-between">
              <h2 className="eyebrow">Matches</h2>
              <span className="font-mono text-xs text-[var(--ivory-faint)]">
                {isLoadingList ? "Loading…" : replays.length}
              </span>
            </div>
            <div className="mt-4 space-y-2.5">
              {!isLoadingList && !hasReplays && (
                <div className="rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-4 text-center text-xs text-[var(--ivory-dim)]">
                  No completed replays yet.
                  <br />
                  Run a match to generate one.
                </div>
              )}
              {replays.map((replay) => (
                <button
                  key={replay.id}
                  onClick={() => setSelectedId(replay.id)}
                  className={`w-full rounded-xl border px-3.5 py-3 text-left text-xs transition-all duration-200 ${
                    selectedId === replay.id
                      ? "border-[rgba(217,164,65,0.6)] bg-[rgba(217,164,65,0.1)] text-[var(--brass-bright)]"
                      : "border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] text-[var(--ivory-dim)] hover:border-[var(--hairline-strong)] hover:bg-[rgba(243,237,226,0.06)] hover:text-[var(--ivory)]"
                  }`}
                >
                  <div className="truncate font-semibold">
                    {replay.whiteModel} vs {replay.blackModel}
                  </div>
                  <div className="mt-1 text-[11px] opacity-70">
                    Winner: {replay.winner} · {replay.turns} moves
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] opacity-50">
                    {formatTimestamp(replay.endedAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel rise-in rounded-2xl p-6" style={{ animationDelay: "0.16s" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="panel-title truncate text-xl text-[var(--ivory)]">
                  {selectedSummary
                    ? `${selectedSummary.whiteModel} vs ${selectedSummary.blackModel}`
                    : "Select a replay"}
                </h2>
                {selectedSummary && (
                  <p className="mt-1 text-xs text-[var(--ivory-dim)]">
                    Winner: {selectedSummary.winner} · {selectedSummary.turns} moves
                  </p>
                )}
              </div>
              {selectedSummary && (
                <button
                  onClick={() => router.push(`/?replay=${selectedSummary.id}`)}
                  className="btn btn-primary text-xs"
                  aria-label="Play this replay on the 3D board"
                >
                  Play on 3D Board
                </button>
              )}
            </div>

            <div className="mt-6">
              {isLoadingReplay && (
                <div className="rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-4 text-sm text-[var(--ivory-dim)]">
                  Loading replay…
                </div>
              )}
              {!isLoadingReplay && selectedReplay && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-3 font-mono text-[11px] text-[var(--ivory-dim)]">
                    <span>Started {formatTimestamp(selectedReplay.startedAt)}</span>
                    <span>Ended {formatTimestamp(selectedReplay.endedAt)}</span>
                  </div>
                  <div>
                    <p className="eyebrow">Replay log</p>
                    <pre className="log-scroll mt-2 max-h-[420px] overflow-auto rounded-xl border border-[var(--hairline)] bg-[rgba(0,0,0,0.45)] p-4 font-mono text-[11px] leading-relaxed text-[var(--ivory-dim)]">{selectedReplay.replayText}</pre>
                  </div>
                </div>
              )}
              {!isLoadingReplay && !selectedReplay && (
                <div className="rounded-xl border border-[var(--hairline)] bg-[rgba(243,237,226,0.03)] p-6 text-center text-sm text-[var(--ivory-dim)]">
                  Pick a replay from the list to see details.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
