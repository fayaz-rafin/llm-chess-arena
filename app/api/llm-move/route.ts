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

const normalizeBaseUrl = (raw?: string) => {
  if (!raw) return DEFAULT_BASE_URL;
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_BASE_URL;
};

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

  const resolveModelAlias = (input?: string) => {
    if (!input) return input;
    const trimmed = input.trim();
    if (trimmed === "gemini-3-pro") return "gemini-3-pro-preview";
    if (trimmed === "gemini-3-flash") return "gemini-2.5-flash";
    return trimmed;
  };

  const resolvedModel = resolveModelAlias(model);

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

  if (!apiKey || !resolvedModel || apiKey.trim() === "" || resolvedModel.trim() === "") {
    return NextResponse.json(
      { error: "API key and model are required. Please provide valid credentials." },
      { status: 400 }
    );
  }

  // Detect if this is a Gemini API call
  const isGemini = baseUrl?.includes("generativelanguage.googleapis.com") || 
                   baseUrl?.includes("googleapis.com");
  
  // Gemini uses a different endpoint structure
  const endpoint = isGemini 
    ? `${normalizeBaseUrl(baseUrl)}/models/${resolvedModel}:generateContent`
    : `${normalizeBaseUrl(baseUrl)}/chat/completions`;

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

  // Build request body - different formats for different APIs
  let requestBody: any;
  
  if (isGemini) {
    // Gemini API format
    // Note: Gemini 2.5 Flash uses "thinking" tokens for internal reasoning
    // These count toward maxOutputTokens, so we need a much higher limit
    // Thinking tokens can use 1000+ tokens, so we set a high limit
    requestBody = {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${userPrompt}`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192, // Maximum limit - Gemini 2.5 Flash uses "thinking tokens" (internal reasoning) that can consume most of this
        responseMimeType: "application/json",
      }
    };
  } else {
    // OpenAI/Anthropic format
    requestBody = {
      model: resolvedModel,
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };

    // Only add response_format for OpenAI-compatible APIs
    const isOpenAICompatible = baseUrl?.includes("openai.com") || 
                               baseUrl?.includes("anthropic.com") ||
                               !baseUrl || baseUrl === DEFAULT_BASE_URL;
    
    if (isOpenAICompatible) {
      try {
        requestBody.response_format = { type: "json_object" };
      } catch {
        // If there's an issue, just continue without it
      }
    }
  }

  // Gemini uses different headers
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  
  if (isGemini) {
    // Gemini uses x-goog-api-key header instead of Authorization Bearer
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn("LLM API error", errorText);
      let errorMessage = `LLM API call failed with status ${response.status}.`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
        
        // Detect Gemini 3 Pro Preview free tier exhaustion
        const isGemini3QuotaError = 
          (errorData.error?.status === "RESOURCE_EXHAUSTED" || response.status === 429) &&
          (errorMessage.includes("limit: 0") || 
           errorMessage.includes("gemini-3-pro") ||
           errorMessage.includes("free_tier_requests"));
        
        const isGemini3Model = resolvedModel?.includes("gemini-3") || 
                               resolvedModel?.includes("pro-preview") ||
                               errorMessage.includes("gemini-3-pro");
        
        if (isGemini3QuotaError && isGemini3Model) {
          errorMessage = "Gemini 3 Pro Preview currently has no free tier. Please enable billing in Google AI Studio (https://ai.google.dev/) or switch to a model with a free tier like 'Gemini 2.5 Flash' or 'GPT-4o'.";
        } else if (response.status === 429) {
          // Check for rate limit errors (429) - these might be temporary
          const retryAfter = response.headers.get("retry-after");
          if (retryAfter) {
            errorMessage += ` Please wait ${retryAfter} seconds before trying again.`;
          } else {
            errorMessage += " This usually means you've hit your API quota/rate limit. Please check your billing or wait a moment and try again.";
          }
        }
      } catch {
        // If error text isn't JSON, use it as-is
        if (errorText) {
          errorMessage = errorText.substring(0, 500);
        }
      }
      
      return NextResponse.json(
        { 
          error: errorMessage,
          statusCode: response.status,
          isRateLimit: response.status === 429
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Check if the response itself contains an error (some APIs do this)
    if (data?.error) {
      console.warn("LLM API returned error in response body:", data.error);
      
      let customMsg = data.error.message || JSON.stringify(data.error);
      
      // Detect Gemini 3 Free Tier exhaustion
      const isGemini3InError = customMsg.includes("gemini-3-pro") || 
                                resolvedModel?.includes("gemini-3") || 
                                resolvedModel?.includes("pro-preview");
      
      if (
        isGemini3InError &&
        (data.error.status === "RESOURCE_EXHAUSTED" || 
         customMsg.includes("limit: 0") ||
         customMsg.includes("free_tier_requests"))
      ) {
        customMsg = "Gemini 3 Pro Preview currently has no free tier. Please enable billing in Google AI Studio (https://ai.google.dev/) or switch to a model with a free tier like 'Gemini 2.5 Flash' or 'GPT-4o'.";
      }

      return NextResponse.json(
        { 
          error: `LLM API error: ${customMsg}` 
        },
        { status: 422 }
      );
    }
    
    // Log the full response for debugging
    console.log("LLM API response structure:", JSON.stringify(data, null, 2).substring(0, 500));
    
    // Try different response formats - some APIs structure responses differently
    let content: string = "";
    
    if (isGemini) {
      // Gemini API response format
      const candidate = data?.candidates?.[0];
      const candidateContent = candidate?.content;
      
      if (candidateContent?.parts && Array.isArray(candidateContent.parts) && candidateContent.parts.length > 0) {
        // Check all parts for text content
        for (const part of candidateContent.parts) {
          if (part?.text) {
            content = part.text;
            break;
          }
        }
      }
      
      // If MAX_TOKENS and no content, check if there's any partial response
      if (!content && candidate?.finishReason === "MAX_TOKENS") {
        console.warn("Gemini hit MAX_TOKENS with no content. This may be due to thinking tokens consuming the limit.");
        // Try to see if there's any text in the response at all
        if (candidateContent && JSON.stringify(candidateContent).includes("text")) {
          // Try to extract any partial JSON
          const responseStr = JSON.stringify(data);
          const jsonMatch = responseStr.match(/\{"from":\[[\d,]+],"to":\[[\d,]+]\}/);
          if (jsonMatch) {
            content = jsonMatch[0];
          }
        }
      }
    } else {
      // Standard OpenAI format
      if (data?.choices?.[0]?.message?.content) {
        content = data.choices[0].message.content;
      }
      // Alternative format (some APIs)
      else if (data?.content) {
        content = data.content;
      }
      // Another alternative
      else if (data?.message?.content) {
        content = data.message.content;
      }
      // Check if response is in a different structure
      else if (data?.choices && Array.isArray(data.choices) && data.choices.length > 0) {
        const firstChoice = data.choices[0];
        if (firstChoice?.text) {
          content = firstChoice.text;
        } else if (firstChoice?.delta?.content) {
          content = firstChoice.delta.content;
        } else if (typeof firstChoice === "string") {
          content = firstChoice;
        }
      }
      // Direct string response
      else if (typeof data === "string") {
        content = data;
      }
    }
    
    // Check for truncated response - but try to parse it anyway
    const finishReason = isGemini 
      ? data?.candidates?.[0]?.finishReason
      : data?.choices?.[0]?.finish_reason;
    
    if (finishReason === "length" || finishReason === "MAX_TOKENS") {
      console.warn("LLM response was truncated due to token limit, but attempting to parse anyway");
      // Don't return error immediately - try to parse what we have
    }
    
    if (!content || content.trim() === "") {
      console.warn("LLM returned empty response. Full response:", JSON.stringify(data, null, 2));
      
      // Special handling for Gemini MAX_TOKENS
      if (isGemini && finishReason === "MAX_TOKENS") {
        const usage = data?.usageMetadata;
        const thoughtsTokens = usage?.thoughtsTokenCount || 0;
        return NextResponse.json(
          { 
            error: `${model} hit the token limit. The model used ${thoughtsTokens} "thinking tokens" (internal reasoning) which count toward the output limit. This is a built-in feature of some Gemini models that cannot be disabled. Recommendation: Use a different model like GPT-4o, Claude, or a standard Gemini model (if available) for more reliable chess moves.`,
            debug: `Finish reason: ${finishReason}, Thinking tokens: ${thoughtsTokens}, Total tokens: ${usage?.totalTokenCount || 'unknown'}, Max output tokens: 8192`
          },
          { status: 422 }
        );
      }
      
      return NextResponse.json(
        { 
          error: "LLM returned an empty response. Please check your API key and model configuration. The API may use a different response format.",
          debug: `Response structure: ${JSON.stringify(Object.keys(data || {})).substring(0, 200)}`
        },
        { status: 422 }
      );
    }

    // Clean up the content - remove markdown code blocks if present
    content = content.trim();
    if (content.startsWith("```")) {
      const lines = content.split("\n");
      content = lines.slice(1, -1).join("\n").trim();
    }
    
    // If response was truncated, try harder to extract the move
    if (finishReason === "length") {
      console.warn("Response was truncated, attempting to extract move from partial content:", content.substring(0, 100));
      // The parser should handle incomplete JSON, so continue
    }

    const move = legalMoveFromResponse(content);

    if (!move) {
      console.warn("Failed to parse LLM response. Raw content:", content.substring(0, 500));
      return NextResponse.json(
        { 
          error: `Unable to parse LLM move response. The LLM did not return a valid move format. Expected: {"from":[row,col],"to":[row,col]}. Received: ${content.substring(0, 200)}` 
        },
        { status: 422 }
      );
    }

    const isLegal = legalMoves.some(
      (legalMove) =>
        legalMove.from[0] === move.from[0] &&
        legalMove.from[1] === move.from[1] &&
        legalMove.to[0] === move.to[0] &&
        legalMove.to[1] === move.to[1]
    );

    if (!isLegal) {
      return NextResponse.json(
        { error: "LLM suggested an illegal move. The move is not in the list of legal moves." },
        { status: 422 }
      );
    }

    return NextResponse.json({ move });
  } catch (error) {
    console.warn("LLM move route error", error);
    return NextResponse.json(
      { error: error instanceof Error ? `Unexpected error: ${error.message}` : "Unexpected error while querying LLM." },
      { status: 500 }
    );
  }
}
