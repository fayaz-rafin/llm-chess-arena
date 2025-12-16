import { NextRequest, NextResponse } from "next/server";
import { openRouterChatCompletion } from "@/app/lib/openrouter";
import {
  consumeRateLimit,
  estimateTokensForMessages,
  getOpenRouterRateLimitConfig,
} from "@/app/lib/rateLimit";

type Move = {
  from: [number, number];
  to: [number, number];
};

type Piece = {
  type: string;
  color: string;
};

type BoardState = (Piece | null)[][];

const legalMoveFromResponse = (text: string): Move | null => {
  if (!text || typeof text !== "string") return null;

  // Clean up the text first
  let cleanedText = text.trim();
  
  // Remove markdown code blocks if present
  if (cleanedText.startsWith("```json")) {
    cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleanedText.startsWith("```")) {
    cleanedText = cleanedText.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  cleanedText = cleanedText.trim();

  // Try to find JSON object in the response
  // First, try to find a complete JSON object
  let jsonMatch = cleanedText.match(/\{[^{}]*"from"[^{}]*"to"[^{}]*\}/);
  
  // If that doesn't work, try a more flexible match
  if (!jsonMatch) {
    jsonMatch = cleanedText.match(/\{[\s\S]*?\}/);
  }

  // If still no match, try to find incomplete JSON and complete it
  if (!jsonMatch) {
    const incompleteMatch = cleanedText.match(/\{[^{}]*"from"[^{}]*"to"[^{}]*/);
    if (incompleteMatch) {
      // Try to complete the JSON
      let incompleteJson = incompleteMatch[0];
      // If it ends with a comma or incomplete array, try to fix it
      if (incompleteJson.includes('"to":[') && !incompleteJson.includes(']}')) {
        // Try to extract what we have and complete it
        const toMatch = incompleteJson.match(/"to":\[(\d+),?\s*(\d*)/);
        if (toMatch) {
          const firstNum = toMatch[1];
          const secondNum = toMatch[2] || "0"; // Default to 0 if missing
          incompleteJson = incompleteJson.replace(/"to":\[(\d+),?\s*(\d*)/, `"to":[${firstNum},${secondNum}]`);
          incompleteJson += "}";
          jsonMatch = [incompleteJson];
        }
      }
    }
  }

  if (!jsonMatch) {
    console.warn("No JSON object found in LLM response:", cleanedText.substring(0, 200));
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Try different possible formats
    let from: [number, number] | null = null;
    let to: [number, number] | null = null;

    // Format 1: {from: [r, c], to: [r, c]}
    if (Array.isArray(parsed.from) && Array.isArray(parsed.to)) {
      from = [Number(parsed.from[0]), Number(parsed.from[1])];
      to = [Number(parsed.to[0]), Number(parsed.to[1])];
    }
    // Format 2: {from: {row: r, col: c}, to: {row: r, col: c}}
    else if (parsed.from && parsed.to && typeof parsed.from === "object" && typeof parsed.to === "object") {
      from = [Number(parsed.from.row ?? parsed.from[0]), Number(parsed.from.col ?? parsed.from[1])];
      to = [Number(parsed.to.row ?? parsed.to[0]), Number(parsed.to.col ?? parsed.to[1])];
    }
    // Format 3: Direct coordinates
    else if (parsed.row !== undefined && parsed.col !== undefined && parsed.toRow !== undefined && parsed.toCol !== undefined) {
      from = [Number(parsed.row), Number(parsed.col)];
      to = [Number(parsed.toRow), Number(parsed.toCol)];
    }

    if (from && to && 
        !isNaN(from[0]) && !isNaN(from[1]) && 
        !isNaN(to[0]) && !isNaN(to[1]) &&
        from[0] >= 0 && from[0] < 8 && from[1] >= 0 && from[1] < 8 &&
        to[0] >= 0 && to[0] < 8 && to[1] >= 0 && to[1] < 8) {
      return { from, to };
    }
  } catch (error) {
    console.warn("Failed to parse LLM move response:", error, "Response:", text.substring(0, 200));
  }

  // Last resort: try to extract numbers from the text
  // Look for patterns like "from":[6,4] and "to":[4,
  const fromMatch = cleanedText.match(/"from"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
  const toMatch = cleanedText.match(/"to"\s*:\s*\[\s*(\d+)\s*,?\s*(\d*)\s*/);
  
  if (fromMatch && toMatch) {
    const fromRow = Number(fromMatch[1]);
    const fromCol = Number(fromMatch[2]);
    const toRow = Number(toMatch[1]);
    const toCol = toMatch[2] ? Number(toMatch[2]) : null;
    
    if (!isNaN(fromRow) && !isNaN(fromCol) && !isNaN(toRow) &&
        fromRow >= 0 && fromRow < 8 && fromCol >= 0 && fromCol < 8 &&
        toRow >= 0 && toRow < 8) {
      // If toCol is missing, try to infer it or use 0 as fallback
      // But actually, we need the second coordinate, so let's try to find it
      if (toCol === null || isNaN(toCol)) {
        // Look for the next number after the toRow
        const afterToRow = cleanedText.substring(cleanedText.indexOf(toMatch[0]) + toMatch[0].length);
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
        // If we can't find it, we can't make a valid move
        console.warn("Could not extract complete 'to' coordinates from:", cleanedText.substring(0, 200));
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
  
  // Even more fallback: try to extract any 4 numbers
  const numbers = cleanedText.match(/\d+/g);
  if (numbers && numbers.length >= 3) {
    const nums = numbers.map(Number).filter(n => n >= 0 && n < 8);
    if (nums.length >= 3) {
      // Use first 3 numbers, infer 4th if needed
      const inferred = nums.length >= 4 ? nums[3] : 0;
      return {
        from: [nums[0], nums[1]],
        to: [nums[2], inferred],
      };
    }
  }

  console.warn("Could not extract valid move from LLM response:", cleanedText.substring(0, 200));
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

  const resolvedModel = typeof model === "string" ? model.trim() : "";
  if (!resolvedModel) {
    return NextResponse.json(
      { error: "Model is required. Provide an OpenRouter model id (e.g. openai/gpt-4o)." },
      { status: 400 }
    );
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

  // Limit move history to last 10 moves to keep prompt shorter
  const recentHistory = (history ?? []).slice(-10);
  
  const userPrompt = `Board (0=Black back, 7=White back):
${boardToAscii(board)}

Legal moves: ${JSON.stringify(legalMoves)}

Recent moves: ${recentHistory.join(" | ")}

Playing as ${turn}. Return ONLY: {"from":[r,c],"to":[r,c]}`;

  try {
    const MAX_ATTEMPTS = 5;
    const legalMoveSet = new Set(
      legalMoves.map((entry) => JSON.stringify(entry))
    );
    const { maxRequestsPerMinute, maxEstimatedTokensPerMinute } =
      getOpenRouterRateLimitConfig();

    const cleanContent = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("```")) return trimmed;
      const lines = trimmed.split("\n");
      return lines.slice(1, -1).join("\n").trim();
    };

    const resolveClientId = () => {
      const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const realIp = request.headers.get("x-real-ip")?.trim();
      return forwarded || realIp || "unknown";
    };

    const clientId = resolveClientId();

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

      // Best-effort token budgeting: prompt estimate + requested completion tokens.
      const estimatedPromptTokens = estimateTokensForMessages(messages);
      const estimatedTotalTokens = estimatedPromptTokens + 500;
      const limiterKey = `openrouter:${clientId}:${resolvedModel}`;
      const limitResult = consumeRateLimit({
        key: limiterKey,
        tokensToConsume: estimatedTotalTokens,
        maxRequestsPerWindow: maxRequestsPerMinute,
        maxTokensPerWindow: maxEstimatedTokensPerMinute,
      });

      if (!limitResult.allowed) {
        const fallbackMove =
          legalMoves[Math.floor(Math.random() * legalMoves.length)]!;
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
        temperature: 0.1,
        max_tokens: 500,
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

      const serializedMove = JSON.stringify(move);
      if (!legalMoveSet.has(serializedMove)) {
        console.warn(
          `LLM suggested illegal move (attempt ${attempt}/${MAX_ATTEMPTS}). Move:`,
          serializedMove
        );
        continue;
      }

      return NextResponse.json({ move, attemptsUsed: attempt });
    }

    // Never stop the game: if the model keeps failing, pick a random legal move.
    const fallbackMove = legalMoves[Math.floor(Math.random() * legalMoves.length)]!;
    return NextResponse.json({
      move: fallbackMove,
      attemptsUsed: MAX_ATTEMPTS,
      fallback: true,
      note: "Model failed to provide a valid legal move after retries; server selected a random legal move to keep the game running.",
    });
  } catch (error) {
    console.warn("LLM move route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? `OpenRouter error: ${error.message}` : "Unexpected error while querying OpenRouter." },
      { status: 500 }
    );
  }
}
