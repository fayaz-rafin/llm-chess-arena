import { NextRequest, NextResponse } from "next/server";
import {
  isAllowedModel,
  isBoardCoord,
  resolveClientId,
} from "@/app/lib/allowedModels";
import { openRouterChatCompletion } from "@/app/lib/openrouter";
import {
  consumeRateLimit,
  estimateTokensForMessages,
  getOpenRouterRateLimitConfig,
} from "@/app/lib/rateLimit";

export const maxDuration = 60;

type Move = {
  from: [number, number];
  to: [number, number];
};

type Piece = {
  type: string;
  color: string;
};

type BoardState = (Piece | null)[][];

const PIECE_TYPES = new Set([
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
]);
const PIECE_COLORS = new Set(["white", "black"]);

const PIECE_TO_SYMBOL: Record<string, string> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};

const isValidPiece = (square: unknown): square is Piece | null => {
  if (square === null) return true;
  if (!square || typeof square !== "object") return false;
  const piece = square as Piece;
  return (
    typeof piece.type === "string" &&
    typeof piece.color === "string" &&
    PIECE_TYPES.has(piece.type) &&
    PIECE_COLORS.has(piece.color)
  );
};

const isValidBoard = (board: unknown): board is BoardState => {
  if (!Array.isArray(board) || board.length !== 8) return false;
  return board.every(
    (row) => Array.isArray(row) && row.length === 8 && row.every(isValidPiece)
  );
};

const legalMoveFromResponse = (text: string): Move | null => {
  if (!text || typeof text !== "string") return null;

  let cleanedText = text.trim();

  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  cleanedText = cleanedText.trim();

  let jsonMatch = cleanedText.match(/\{[^{}]*"from"[^{}]*"to"[^{}]*\}/);

  if (!jsonMatch) {
    jsonMatch = cleanedText.match(/\{[\s\S]*?\}/);
  }

  if (!jsonMatch) {
    const incompleteMatch = cleanedText.match(/\{[^{}]*"from"[^{}]*"to"[^{}]*/);
    if (incompleteMatch) {
      let incompleteJson = incompleteMatch[0];
      if (incompleteJson.includes('"to":[') && !incompleteJson.includes("]}")) {
        const toMatch = incompleteJson.match(/"to":\[(\d+),?\s*(\d*)/);
        if (toMatch) {
          const firstNum = toMatch[1];
          const secondNum = toMatch[2] || "0";
          incompleteJson = incompleteJson.replace(
            /"to":\[(\d+),?\s*(\d*)/,
            `"to":[${firstNum},${secondNum}]`
          );
          incompleteJson += "}";
          jsonMatch = [incompleteJson];
        }
      }
    }
  }

  if (!jsonMatch) {
    console.warn(
      "No JSON object found in LLM response:",
      cleanedText.substring(0, 200)
    );
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    let from: [number, number] | null = null;
    let to: [number, number] | null = null;

    if (Array.isArray(parsed.from) && Array.isArray(parsed.to)) {
      from = [Number(parsed.from[0]), Number(parsed.from[1])];
      to = [Number(parsed.to[0]), Number(parsed.to[1])];
    } else if (
      parsed.from &&
      parsed.to &&
      typeof parsed.from === "object" &&
      typeof parsed.to === "object"
    ) {
      from = [
        Number(parsed.from.row ?? parsed.from[0]),
        Number(parsed.from.col ?? parsed.from[1]),
      ];
      to = [
        Number(parsed.to.row ?? parsed.to[0]),
        Number(parsed.to.col ?? parsed.to[1]),
      ];
    } else if (
      parsed.row !== undefined &&
      parsed.col !== undefined &&
      parsed.toRow !== undefined &&
      parsed.toCol !== undefined
    ) {
      from = [Number(parsed.row), Number(parsed.col)];
      to = [Number(parsed.toRow), Number(parsed.toCol)];
    }

    if (
      from &&
      to &&
      !isNaN(from[0]) &&
      !isNaN(from[1]) &&
      !isNaN(to[0]) &&
      !isNaN(to[1]) &&
      from[0] >= 0 &&
      from[0] < 8 &&
      from[1] >= 0 &&
      from[1] < 8 &&
      to[0] >= 0 &&
      to[0] < 8 &&
      to[1] >= 0 &&
      to[1] < 8
    ) {
      return { from, to };
    }
  } catch (error) {
    console.warn(
      "Failed to parse LLM move response:",
      error,
      "Response:",
      text.substring(0, 200)
    );
  }

  const fromMatch = cleanedText.match(
    /"from"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/
  );
  const toMatch = cleanedText.match(
    /"to"\s*:\s*\[\s*(\d+)\s*,?\s*(\d*)\s*/
  );

  if (fromMatch && toMatch) {
    const fromRow = Number(fromMatch[1]);
    const fromCol = Number(fromMatch[2]);
    const toRow = Number(toMatch[1]);
    const toCol = toMatch[2] ? Number(toMatch[2]) : null;

    if (
      !isNaN(fromRow) &&
      !isNaN(fromCol) &&
      !isNaN(toRow) &&
      fromRow >= 0 &&
      fromRow < 8 &&
      fromCol >= 0 &&
      fromCol < 8 &&
      toRow >= 0 &&
      toRow < 8
    ) {
      if (toCol === null || isNaN(toCol)) {
        const afterToRow = cleanedText.substring(
          cleanedText.indexOf(toMatch[0]) + toMatch[0].length
        );
        const nextNumMatch = afterToRow.match(/(\d+)/);
        if (nextNumMatch) {
          const inferredCol = Number(nextNumMatch[1]);
          if (inferredCol >= 0 && inferredCol < 8) {
            return {
              from: [fromRow, fromCol],
              to: [toRow, inferredCol],
            };
          }
        }
        console.warn(
          "Could not extract complete 'to' coordinates from:",
          cleanedText.substring(0, 200)
        );
        return null;
      }

      if (toCol >= 0 && toCol < 8) {
        return {
          from: [fromRow, fromCol],
          to: [toRow, toCol],
        };
      }
    }
  }

  const numbers = cleanedText.match(/\d+/g);
  if (numbers && numbers.length >= 3) {
    const nums = numbers.map(Number).filter((n) => n >= 0 && n < 8);
    if (nums.length >= 3) {
      const inferred = nums.length >= 4 ? nums[3] : 0;
      return {
        from: [nums[0], nums[1]],
        to: [nums[2], inferred],
      };
    }
  }

  console.warn(
    "Could not extract valid move from LLM response:",
    cleanedText.substring(0, 200)
  );
  return null;
};

const boardToAscii = (board: BoardState) =>
  board
    .map((row, rowIndex) => {
      const rendered = row
        .map((square) => {
          if (!square) return ".";
          const base =
            PIECE_TO_SYMBOL[square.type] ?? square.type.charAt(0).toLowerCase();
          return square.color === "white" ? base.toUpperCase() : base;
        })
        .join(" ");
      return `${rowIndex} ${rendered}`;
    })
    .join("\n");

const formatLegalMove = (move: Move) =>
  `[${move.from[0]},${move.from[1]}]->[${move.to[0]},${move.to[1]}]`;

const normalizeMove = (entry: { from: unknown; to: unknown }): Move | null => {
  if (!isBoardCoord(entry.from) || !isBoardCoord(entry.to)) return null;
  return {
    from: [entry.from[0], entry.from[1]],
    to: [entry.to[0], entry.to[1]],
  };
};

export async function POST(request: NextRequest) {
  let payload: {
    turn?: string;
    legalMoves?: unknown[];
    board?: unknown;
    history?: unknown;
    model?: string;
  } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const { turn, legalMoves, board, history, model } = payload;

  if (turn !== "white" && turn !== "black") {
    return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
  }

  if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
    return NextResponse.json(
      { error: "Missing turn or legalMoves" },
      { status: 400 }
    );
  }

  if (legalMoves.length > 256) {
    return NextResponse.json({ error: "Invalid legalMoves" }, { status: 400 });
  }

  const normalizedMoves: Move[] = [];
  for (const entry of legalMoves) {
    if (!entry || typeof entry !== "object") {
      return NextResponse.json({ error: "Invalid legalMoves" }, { status: 400 });
    }
    const move = normalizeMove(entry as { from: unknown; to: unknown });
    if (!move) {
      return NextResponse.json({ error: "Invalid legalMoves" }, { status: 400 });
    }
    normalizedMoves.push(move);
  }

  if (!isValidBoard(board)) {
    return NextResponse.json({ error: "Invalid board" }, { status: 400 });
  }

  if (
    history !== undefined &&
    (!Array.isArray(history) ||
      history.length > 300 ||
      history.some((h) => typeof h !== "string" || h.length > 32))
  ) {
    return NextResponse.json({ error: "Invalid history" }, { status: 400 });
  }

  const resolvedModel = typeof model === "string" ? model.trim() : "";
  if (!isAllowedModel(resolvedModel)) {
    return NextResponse.json({ error: "Model not allowed" }, { status: 400 });
  }

  const systemPrompt = `You are a precise chess engine. You must choose exactly one legal move for ${turn}.

CRITICAL RULES:
1. Respond with ONLY a JSON object - nothing else
2. Use this exact format: {"from":[row,col],"to":[row,col]}
3. row and col are numbers between 0 and 7 (0-indexed coordinates)
4. Do NOT include explanations, comments, markdown, code blocks, or any other text
5. Do NOT use backticks or formatting
6. Start your response with { and end with }

Example of correct response: {"from":[6,4],"to":[4,4]}`;

  const recentHistory = ((history as string[] | undefined) ?? []).slice(-4);
  const legalMovesCompact = normalizedMoves.map(formatLegalMove).join(" ");

  const userPrompt = `Board (rows 0-7 top to bottom, cols 0-7 left to right):
${boardToAscii(board)}
  0 1 2 3 4 5 6 7

Legal moves (MUST pick exactly one): ${legalMovesCompact}

Recent moves: ${recentHistory.join(" | ")}

Playing as ${turn}. Return ONLY JSON: {"from":[r,c],"to":[r,c]}`;

  try {
    const MAX_ATTEMPTS = 5;
    const legalMoveSet = new Set(
      normalizedMoves.map((move) =>
        JSON.stringify({ from: move.from, to: move.to })
      )
    );
    const { maxRequestsPerMinute, maxEstimatedTokensPerMinute } =
      getOpenRouterRateLimitConfig();

    const cleanContent = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("```")) return trimmed;
      const lines = trimmed.split("\n");
      return lines.slice(1, -1).join("\n").trim();
    };

    const clientId = resolveClientId(request);
    const limiterKey = `openrouter:${clientId}`;

    let lastRawResponse = "";
    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;

      const attemptPrompt =
        attempt === 1
          ? userPrompt
          : `${userPrompt}

The previous response was invalid.
- Attempt: ${attempt - 1}
- Previous response (verbatim): ${JSON.stringify(lastRawResponse.slice(0, 500))}

CRITICAL: Choose ONE move ONLY from the provided legalMoves list. Output must be EXACT JSON: {"from":[r,c],"to":[r,c]}.`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: attemptPrompt },
      ];

      const estimatedPromptTokens = estimateTokensForMessages(messages);
      const estimatedTotalTokens = estimatedPromptTokens + 64;
      const limitResult = consumeRateLimit({
        key: limiterKey,
        tokensToConsume: estimatedTotalTokens,
        maxRequestsPerWindow: maxRequestsPerMinute,
        maxTokensPerWindow: maxEstimatedTokensPerMinute,
      });

      if (!limitResult.allowed) {
        const fallbackMove =
          normalizedMoves[Math.floor(Math.random() * normalizedMoves.length)]!;
        return NextResponse.json({
          move: fallbackMove,
          attemptsUsed: attempt - 1,
          fallback: true,
          rateLimited: true,
          retryAfterMs: limitResult.retryAfterMs,
          note:
            limitResult.reason === "tokens"
              ? "Rate limited to avoid exceeding the configured token budget; server selected a random legal move to keep the game running."
              : "Rate limited to avoid exceeding the configured request budget; server selected a random legal move to keep the game running.",
        });
      }

      const { content } = await openRouterChatCompletion({
        model: resolvedModel,
        temperature: 0,
        max_tokens: 64,
        messages,
      });

      lastRawResponse = content;
      const cleaned = cleanContent(content);
      const move = legalMoveFromResponse(cleaned);

      if (!move) {
        console.warn(
          `LLM move parse failed (attempt ${attempt}/${MAX_ATTEMPTS}). Raw:`,
          cleaned.substring(0, 300)
        );
        continue;
      }

      const serializedMove = JSON.stringify({ from: move.from, to: move.to });
      if (!legalMoveSet.has(serializedMove)) {
        console.warn(
          `LLM suggested illegal move (attempt ${attempt}/${MAX_ATTEMPTS}). Move:`,
          serializedMove
        );
        continue;
      }

      return NextResponse.json({ move, attemptsUsed: attempt });
    }

    const fallbackMove =
      normalizedMoves[Math.floor(Math.random() * normalizedMoves.length)]!;
    return NextResponse.json({
      move: fallbackMove,
      attemptsUsed: MAX_ATTEMPTS,
      fallback: true,
      note: "Model failed to provide a valid legal move after retries; server selected a random legal move to keep the game running.",
    });
  } catch (error) {
    console.warn("LLM move route error", error);
    return NextResponse.json(
      { error: "Failed to get move from model" },
      { status: 500 }
    );
  }
}
