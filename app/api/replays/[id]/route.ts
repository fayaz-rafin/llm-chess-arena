import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

type Params = {
  params: Promise<{ id: string }>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
