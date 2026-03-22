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
    <div className="relative min-h-screen text-white">
      <ArenaBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Replays</h1>
            <p className="mt-1 text-sm text-white/60">
              Browse completed matches and replay them on the live arena.
            </p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="rounded-full border border-white/20 px-4 py-2 text-xs text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Back to Arena
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-red-500/50 bg-red-500/20 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">
                Replay List
              </h2>
              <span className="text-xs text-white/40">
                {isLoadingList ? "Loading…" : `${replays.length} total`}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {!isLoadingList && !hasReplays && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                  No completed replays yet. Run a match to generate one.
                </div>
              )}
              {replays.map((replay) => (
                <button
                  key={replay.id}
                  onClick={() => setSelectedId(replay.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left text-xs transition ${
                    selectedId === replay.id
                      ? "border-teal-400/70 bg-teal-400/10 text-teal-100"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                  }`}
                >
                  <div className="font-semibold">
                    {replay.whiteModel} vs {replay.blackModel}
                  </div>
                  <div className="mt-1 text-[11px] text-white/50">
                    Winner: {replay.winner} · Moves: {replay.turns}
                  </div>
                  <div className="mt-1 text-[11px] text-white/40">
                    {formatTimestamp(replay.endedAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {selectedSummary
                    ? `${selectedSummary.whiteModel} vs ${selectedSummary.blackModel}`
                    : "Select a replay"}
                </h2>
                {selectedSummary && (
                  <p className="mt-1 text-xs text-white/60">
                    Winner: {selectedSummary.winner} · Moves: {selectedSummary.turns}
                  </p>
                )}
              </div>
              {selectedSummary && (
                <button
                  onClick={() => router.push(`/?replay=${selectedSummary.id}`)}
                  className="rounded-full bg-teal-400 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-teal-300"
                >
                  Play on 3D Board
                </button>
              )}
            </div>

            <div className="mt-6">
              {isLoadingReplay && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                  Loading replay…
                </div>
              )}
              {!isLoadingReplay && selectedReplay && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/70">
                    <div>Started: {formatTimestamp(selectedReplay.startedAt)}</div>
                    <div>Ended: {formatTimestamp(selectedReplay.endedAt)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-white/60">
                      Replay Log
                    </div>
                    <pre className="mt-2 max-h-[420px] overflow-auto rounded-xl border border-white/10 bg-black/60 p-4 text-[11px] leading-relaxed text-white/70">{selectedReplay.replayText}</pre>
                  </div>
                </div>
              )}
              {!isLoadingReplay && !selectedReplay && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
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
