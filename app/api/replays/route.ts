import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

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
  replayText?: string;
};

export async function POST(request: NextRequest) {
  let payload: ReplayPayload = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const { meta, endedAt, winner, turns, events, replayText } = payload;

  if (
    !meta?.clientMatchId ||
    !meta?.startedAt ||
    !meta?.whiteModel ||
    !meta?.blackModel ||
    !endedAt ||
    !winner ||
    typeof turns !== "number" ||
    !Array.isArray(events) ||
    !replayText
  ) {
    return NextResponse.json(
      { error: "Missing replay fields" },
      { status: 400 }
    );
  }

  const id = randomUUID();

  try {
    await prisma.replay.create({
      data: {
        id,
        clientMatchId: meta.clientMatchId,
        startedAt: new Date(meta.startedAt),
        endedAt: new Date(endedAt),
        winner,
        turns,
        whiteModel: meta.whiteModel,
        blackModel: meta.blackModel,
        replayText,
        replayJson: {
          meta,
          endedAt,
          winner,
          turns,
          events,
        } as Prisma.InputJsonValue,
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
  const limit = Math.min(
    Math.max(Number(limitParam) || 25, 1),
    100
  );

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
