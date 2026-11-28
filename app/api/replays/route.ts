import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isBoardCoord, resolveClientId } from "@/app/lib/allowedModels";
import { prisma } from "@/app/lib/prisma";
import { consumeRateLimit } from "@/app/lib/rateLimit";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TURNS = 2000;
const MAX_MODEL_ID_LENGTH = 200;
const MAX_CLIENT_MATCH_ID_LENGTH = 128;
const MAX_STRING_FIELD = 512;
const MAX_BOARD_ASCII = 512;
const REPLAY_MAX_REQUESTS_PER_MINUTE = 10;

type ReplayPayload = {
  meta?: {
    clientMatchId?: string;
    startedAt?: string;
    whiteModel?: string;
    blackModel?: string;
  };
  endedAt?: string;
  winner?: "white" | "black";
  turns?: number;
  events?: unknown[];
};

const isFiniteDate = (value: string) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

const clampModelId = (value: string) => value.slice(0, MAX_MODEL_ID_LENGTH);

const sanitizeEvents = (events: unknown[], turns: number) => {
  const maxEvents = 4 * turns + 2;
  if (events.length > maxEvents) return null;

  const sanitized: unknown[] = [];

  for (const event of events) {
    if (!event || typeof event !== "object") return null;
    const entry = event as Record<string, unknown>;
    const type = entry.t;
    if (typeof type !== "string") return null;

    if (type === "move") {
      if (!isBoardCoord(entry.from) || !isBoardCoord(entry.to)) return null;
      if (typeof entry.ply !== "number" || !Number.isInteger(entry.ply)) {
        return null;
      }
      if (entry.color !== "white" && entry.color !== "black") return null;
      if (
        typeof entry.notation !== "string" ||
        entry.notation.length > MAX_STRING_FIELD
      ) {
        return null;
      }
      if (typeof entry.at !== "string" || entry.at.length > MAX_STRING_FIELD) {
        return null;
      }
      sanitized.push({
        t: "move",
        at: entry.at,
        ply: entry.ply,
        color: entry.color,
        notation: entry.notation.slice(0, MAX_STRING_FIELD),
        from: [entry.from[0], entry.from[1]],
        to: [entry.to[0], entry.to[1]],
      });
      continue;
    }

    if (type === "match_start") {
      if (
        typeof entry.at !== "string" ||
        typeof entry.clientMatchId !== "string" ||
        typeof entry.whiteModel !== "string" ||
        typeof entry.blackModel !== "string"
      ) {
        return null;
      }
      sanitized.push({
        t: "match_start",
        at: entry.at.slice(0, MAX_STRING_FIELD),
        clientMatchId: entry.clientMatchId.slice(0, MAX_CLIENT_MATCH_ID_LENGTH),
        whiteModel: clampModelId(entry.whiteModel),
        blackModel: clampModelId(entry.blackModel),
      });
      continue;
    }

    if (type === "turn_request") {
      if (
        typeof entry.at !== "string" ||
        typeof entry.ply !== "number" ||
        !Number.isInteger(entry.ply) ||
        (entry.turn !== "white" && entry.turn !== "black") ||
        typeof entry.model !== "string" ||
        typeof entry.legalMovesCount !== "number" ||
        typeof entry.boardAscii !== "string"
      ) {
        return null;
      }
      sanitized.push({
        t: "turn_request",
        at: entry.at.slice(0, MAX_STRING_FIELD),
        ply: entry.ply,
        turn: entry.turn,
        model: clampModelId(entry.model),
        legalMovesCount: Math.min(
          Math.max(0, Math.floor(entry.legalMovesCount)),
          256
        ),
        boardAscii: entry.boardAscii.slice(0, MAX_BOARD_ASCII),
      });
      continue;
    }

    if (type === "llm_decision") {
      const move = entry.move;
      if (
        !move ||
        typeof move !== "object" ||
        !isBoardCoord((move as { from?: unknown }).from) ||
        !isBoardCoord((move as { to?: unknown }).to)
      ) {
        return null;
      }
      const from = (move as { from: [number, number] }).from;
      const to = (move as { to: [number, number] }).to;
      sanitized.push({
        t: "llm_decision",
        at:
          typeof entry.at === "string"
            ? entry.at.slice(0, MAX_STRING_FIELD)
            : "",
        ply:
          typeof entry.ply === "number" && Number.isInteger(entry.ply)
            ? entry.ply
            : 0,
        move: { from: [from[0], from[1]], to: [to[0], to[1]] },
        attemptsUsed:
          typeof entry.attemptsUsed === "number"
            ? Math.min(Math.max(0, Math.floor(entry.attemptsUsed)), 20)
            : undefined,
        fallback: entry.fallback === true,
        rateLimited: entry.rateLimited === true,
        note:
          typeof entry.note === "string"
            ? entry.note.slice(0, MAX_STRING_FIELD)
            : undefined,
      });
      continue;
    }

    if (type === "capture") {
      if (
        typeof entry.at !== "string" ||
        typeof entry.ply !== "number" ||
        !Number.isInteger(entry.ply) ||
        (entry.color !== "white" && entry.color !== "black") ||
        typeof entry.piece !== "string" ||
        typeof entry.value !== "number"
      ) {
        return null;
      }
      sanitized.push({
        t: "capture",
        at: entry.at.slice(0, MAX_STRING_FIELD),
        ply: entry.ply,
        color: entry.color,
        piece: entry.piece.slice(0, 32),
        value: Math.min(Math.max(0, Math.floor(entry.value)), 20),
      });
      continue;
    }

    if (type === "game_over") {
      if (
        typeof entry.at !== "string" ||
        (entry.winner !== "white" && entry.winner !== "black") ||
        typeof entry.reason !== "string"
      ) {
        return null;
      }
      sanitized.push({
        t: "game_over",
        at: entry.at.slice(0, MAX_STRING_FIELD),
        winner: entry.winner,
        reason: entry.reason.slice(0, MAX_STRING_FIELD),
      });
      continue;
    }

    return null;
  }

  return sanitized;
};

const buildReplayText = (params: {
  meta: {
    clientMatchId: string;
    startedAt: string;
    whiteModel: string;
    blackModel: string;
  };
  endedAt: string;
  winner: "white" | "black";
  turns: number;
  events: unknown[];
}) => {
  const lines: string[] = [
    "LLM Chess Arena Replay",
    `Start: ${params.meta.startedAt}`,
    `End: ${params.endedAt}`,
    `White: ${params.meta.whiteModel}`,
    `Black: ${params.meta.blackModel}`,
    `Winner: ${params.winner}`,
    `Total moves: ${params.turns}`,
    "",
  ];

  for (const event of params.events) {
    if (!event || typeof event !== "object") continue;
    const entry = event as Record<string, unknown>;
    if (entry.t === "move") {
      const from = entry.from as [number, number];
      const to = entry.to as [number, number];
      lines.push(
        `Move (ply ${entry.ply}): ${entry.color} ${entry.notation} ([${from[0]},${from[1]}] -> [${to[0]},${to[1]}])`
      );
    } else if (entry.t === "game_over") {
      lines.push(`Game Over: ${entry.winner} wins (${entry.reason})`);
    } else if (entry.t === "match_start") {
      lines.push(
        `Match start (${entry.at}) | id=${entry.clientMatchId} | White=${entry.whiteModel} | Black=${entry.blackModel}`
      );
    }
  }

  return lines.join("\n");
};

export async function POST(request: NextRequest) {
  const clientId = resolveClientId(request);
  const limitResult = consumeRateLimit({
    key: `replays:${clientId}`,
    tokensToConsume: 1,
    maxRequestsPerWindow: REPLAY_MAX_REQUESTS_PER_MINUTE,
    maxTokensPerWindow: REPLAY_MAX_REQUESTS_PER_MINUTE,
  });

  if (!limitResult.allowed) {
    return NextResponse.json(
      { error: "Too many replay saves. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil(limitResult.retryAfterMs / 1000))
          ),
        },
      }
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: ReplayPayload;
  try {
    payload = JSON.parse(raw) as ReplayPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const { meta, endedAt, winner, turns, events } = payload;

  if (
    !meta?.clientMatchId ||
    typeof meta.clientMatchId !== "string" ||
    meta.clientMatchId.length > MAX_CLIENT_MATCH_ID_LENGTH ||
    !meta?.startedAt ||
    typeof meta.startedAt !== "string" ||
    !meta?.whiteModel ||
    typeof meta.whiteModel !== "string" ||
    meta.whiteModel.length > MAX_MODEL_ID_LENGTH ||
    !meta?.blackModel ||
    typeof meta.blackModel !== "string" ||
    meta.blackModel.length > MAX_MODEL_ID_LENGTH ||
    !endedAt ||
    typeof endedAt !== "string" ||
    !isFiniteDate(meta.startedAt) ||
    !isFiniteDate(endedAt)
  ) {
    return NextResponse.json(
      { error: "Missing replay fields" },
      { status: 400 }
    );
  }

  if (winner !== "white" && winner !== "black") {
    return NextResponse.json({ error: "Invalid winner" }, { status: 400 });
  }

  if (
    typeof turns !== "number" ||
    !Number.isInteger(turns) ||
    turns < 0 ||
    turns > MAX_TURNS ||
    !Array.isArray(events)
  ) {
    return NextResponse.json({ error: "Invalid replay" }, { status: 400 });
  }

  const sanitizedEvents = sanitizeEvents(events, turns);
  if (!sanitizedEvents) {
    return NextResponse.json({ error: "Invalid replay events" }, { status: 400 });
  }

  const safeMeta = {
    clientMatchId: meta.clientMatchId.slice(0, MAX_CLIENT_MATCH_ID_LENGTH),
    startedAt: meta.startedAt,
    whiteModel: clampModelId(meta.whiteModel),
    blackModel: clampModelId(meta.blackModel),
  };

  const startedAtDate = new Date(meta.startedAt);
  const endedAtDate = new Date(endedAt);
  // Prevent far-future endedAt from pinning a row at the top of listings.
  const now = Date.now();
  if (endedAtDate.getTime() > now + 60_000) {
    endedAtDate.setTime(now);
  }
  if (startedAtDate.getTime() > endedAtDate.getTime()) {
    return NextResponse.json({ error: "Invalid replay dates" }, { status: 400 });
  }

  const replayText = buildReplayText({
    meta: safeMeta,
    endedAt: endedAtDate.toISOString(),
    winner,
    turns,
    events: sanitizedEvents,
  });

  const id = randomUUID();
  const replayJsonPayload = JSON.parse(
    JSON.stringify({
      meta: safeMeta,
      endedAt: endedAtDate.toISOString(),
      winner,
      turns,
      events: sanitizedEvents,
    })
  );

  try {
    await prisma.replay.create({
      data: {
        id,
        clientMatchId: safeMeta.clientMatchId,
        startedAt: startedAtDate,
        endedAt: endedAtDate,
        winner,
        turns,
        whiteModel: safeMeta.whiteModel,
        blackModel: safeMeta.blackModel,
        replayText,
        replayJson: replayJsonPayload,
      },
    });
  } catch (error) {
    console.warn("Replay insert failed", error);
    return NextResponse.json(
      { error: "Replay insert failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 25, 1), 100);

  try {
    const replays = await prisma.replay.findMany({
      orderBy: { endedAt: "desc" },
      take: limit,
      select: {
        id: true,
        clientMatchId: true,
        startedAt: true,
        endedAt: true,
        winner: true,
        turns: true,
        whiteModel: true,
        blackModel: true,
      },
    });

    return NextResponse.json({ replays });
  } catch (error) {
    console.warn("Replay list failed", error);
    return NextResponse.json(
      { error: "Replay list failed" },
      { status: 500 }
    );
  }
}
