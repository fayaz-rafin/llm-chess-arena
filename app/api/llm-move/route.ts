import { NextRequest, NextResponse } from "next/server";

type Move = {
  from: [number, number];
  to: [number, number];
};

type Piece = {
  type: string;
  color: string;
};

type BoardState = (Piece | null)[][];

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const randomMove = (legalMoves: Move[]): Move =>
  legalMoves[Math.floor(Math.random() * legalMoves.length)];

const normalizeBaseUrl = (raw?: string) => {
  if (!raw) return DEFAULT_BASE_URL;
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_BASE_URL;
};

const legalMoveFromResponse = (text: string): Move | null => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]);
    if (
      parsed &&
      Array.isArray(parsed.from) &&
      Array.isArray(parsed.to) &&
      parsed.from.length === 2 &&
      parsed.to.length === 2
    ) {
      return {
        from: [Number(parsed.from[0]), Number(parsed.from[1])],
        to: [Number(parsed.to[0]), Number(parsed.to[1])],
      };
    }
  } catch (error) {
    console.warn("Failed to parse LLM move response", error);
  }

  return null;
};

const boardToAscii = (board: BoardState) =>
  board
    .map((row) =>
      row
        .map((square) => {
          if (!square) return ".";
          const symbol = square.type.charAt(0).toLowerCase();
          return square.color === "white" ? symbol.toUpperCase() : symbol;
        })
        .join(" ")
    )
    .join("\n");

export async function POST(request: NextRequest) {
  let payload: {
    turn?: string;
    legalMoves?: Move[];
    board?: BoardState;
    history?: string[];
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const { turn, legalMoves, board, history, apiKey, model, baseUrl } = payload;

  if (!turn || !Array.isArray(legalMoves) || legalMoves.length === 0) {
    return NextResponse.json(
      { error: "Missing turn or legalMoves" },
      { status: 400 }
    );
  }

  if (!board) {
    return NextResponse.json(
      { error: "Missing board state" },
      { status: 400 }
    );
  }

  if (!apiKey || !model) {
    return NextResponse.json({ move: randomMove(legalMoves), message: "Falling back to random move (missing apiKey or model)." });
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  const systemPrompt = `You are a precise chess engine. Choose exactly one move for ${turn}. Return JSON {"from":[row,col],"to":[row,col]} using 0-indexed coordinates.`;

  const userPrompt = `Board (row 0 is Black's back rank, row 7 is White's):
${boardToAscii(board)}

Legal moves (0-indexed): ${JSON.stringify(legalMoves)}
Move history: ${(history ?? []).join(" | ")}

Respond ONLY with JSON for one move from the list.`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 150,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      console.warn("LLM API error", await response.text());
      return NextResponse.json({ move: randomMove(legalMoves), message: `LLM call failed with status ${response.status}. Using random move.` });
    }

    const data = await response.json();
    const content: string =
      data?.choices?.[0]?.message?.content ?? "";
    const move = legalMoveFromResponse(content);

    if (!move) {
      return NextResponse.json({ move: randomMove(legalMoves), message: "Unable to parse LLM move. Using random move." });
    }

    const isLegal = legalMoves.some(
      (legalMove) =>
        legalMove.from[0] === move.from[0] &&
        legalMove.from[1] === move.from[1] &&
        legalMove.to[0] === move.to[0] &&
        legalMove.to[1] === move.to[1]
    );

    if (!isLegal) {
      return NextResponse.json({ move: randomMove(legalMoves), message: "LLM suggested illegal move. Using random move." });
    }

    return NextResponse.json({ move });
  } catch (error) {
    console.warn("LLM move route error", error);
    return NextResponse.json({ move: randomMove(legalMoves), message: "Unexpected error while querying LLM. Using random move." });
  }
}
