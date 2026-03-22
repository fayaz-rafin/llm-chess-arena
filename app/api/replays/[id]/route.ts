import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const replay = await prisma.replay.findUnique({
      where: { id },
      select: {
        id: true,
        clientMatchId: true,
        startedAt: true,
        endedAt: true,
        winner: true,
        turns: true,
        whiteModel: true,
        blackModel: true,
        replayText: true,
        replayJson: true,
      },
    });

    if (!replay) {
      return NextResponse.json({ error: "Replay not found" }, { status: 404 });
    }

    return NextResponse.json({ replay });
  } catch (error) {
    console.warn("Replay fetch failed", error);
    return NextResponse.json(
      { error: "Replay fetch failed" },
      { status: 500 }
    );
  }
}
