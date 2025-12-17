type OpenRouterChatRole = "system" | "user" | "assistant" | "tool";

export type OpenRouterChatMessage = {
  role: OpenRouterChatRole;
  content: string;
};

export type OpenRouterChatCompletionParams = {
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
};

export type OpenRouterModelEntry = {
  id: string;
  label?: string;
  provider?: string | null;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const getOpenRouterApiKey = () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Please add it to your .env and restart the dev server."
    );
  }
  return apiKey;
};

const getOptionalHeaders = () => {
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim();

  const headers: Record<string, string> = {};
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return headers;
};

export const openRouterChatCompletion = async (
  params: OpenRouterChatCompletionParams
) => {
  const apiKey = getOpenRouterApiKey();
  const endpoint = `${OPENROUTER_BASE_URL}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...getOptionalHeaders(),
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.1,
      max_tokens: params.max_tokens ?? 500,
      ...(params.response_format ? { response_format: params.response_format } : {}),
    }),
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (text ? text.slice(0, 500) : `OpenRouter responded with ${response.status}.`);
    throw new Error(message);
  }

  const extractText = (payload: any): string => {
    const choice = payload?.choices?.[0];
    const message = choice?.message;

    const contentCandidate = message?.content ?? choice?.text ?? payload?.content;
    if (typeof contentCandidate === "string" && contentCandidate.trim()) {
      return contentCandidate;
    }

    // Some SDKs/providers represent content as an object.
    if (contentCandidate && typeof contentCandidate === "object" && !Array.isArray(contentCandidate)) {
      const maybeText = (contentCandidate as any)?.text;
      if (typeof maybeText === "string" && maybeText.trim()) return maybeText;
      const maybeValue = (contentCandidate as any)?.text?.value;
      if (typeof maybeValue === "string" && maybeValue.trim()) return maybeValue;
      const maybeContent = (contentCandidate as any)?.content;
      if (typeof maybeContent === "string" && maybeContent.trim()) return maybeContent;
    }

    // OpenAI-style structured content parts
    if (Array.isArray(contentCandidate)) {
      const joined = contentCandidate
        .map((part: any) => {
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.text?.value === "string") return part.text.value;
          if (typeof part?.text?.text === "string") return part.text.text;
          if (typeof part?.content === "string") return part.content;
          if (typeof part?.content?.value === "string") return part.content.value;
          if (typeof part?.value === "string") return part.value;
          return "";
        })
        .filter(Boolean)
        .join("");
      if (joined.trim()) return joined;
    }

    // Refusals / content filters often live here.
    const refusal = message?.refusal ?? choice?.refusal;
    if (typeof refusal === "string" && refusal.trim()) return refusal;

    // Tool calling / function calling: arguments often contain JSON we want.
    const toolCalls = message?.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      for (const call of toolCalls) {
        const args = call?.function?.arguments;
        if (typeof args === "string" && args.trim()) return args;
        if (args && typeof args === "object") return JSON.stringify(args);
      }
    }

    const functionCall = message?.function_call;
    const fnArgs = functionCall?.arguments;
    if (typeof fnArgs === "string" && fnArgs.trim()) return fnArgs;
    if (fnArgs && typeof fnArgs === "object") return JSON.stringify(fnArgs);

    // Some providers tuck it into delta/content
    const deltaContent = choice?.delta?.content;
    if (typeof deltaContent === "string" && deltaContent.trim()) return deltaContent;

    return "";
  };

  const extracted = extractText(data);
  if (extracted.trim()) {
    return { content: extracted, raw: data as unknown };
  }

  const choice = data?.choices?.[0];
  const finishReason =
    typeof choice?.finish_reason === "string"
      ? choice.finish_reason
      : typeof choice?.finishReason === "string"
        ? choice.finishReason
        : "unknown";
  const messageKeys =
    choice?.message && typeof choice.message === "object"
      ? Object.keys(choice.message).join(", ")
      : "none";

  throw new Error(
    `OpenRouter returned an empty response. finish_reason=${finishReason}. ` +
      `Top-level keys: ${Object.keys(data || {}).join(", ")}. ` +
      `choice.message keys: ${messageKeys}.`
  );
};

export const fetchOpenRouterModels = async (): Promise<OpenRouterModelEntry[]> => {
  const apiKey = getOpenRouterApiKey();
  const endpoint = `${OPENROUTER_BASE_URL}/models`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...getOptionalHeaders(),
    },
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      (text ? text.slice(0, 500) : `OpenRouter responded with ${response.status}.`);
    throw new Error(message);
  }

  const modelsRaw = Array.isArray(data?.data) ? data.data : [];
  const models = modelsRaw
    .map((entry: any) => {
      const id = typeof entry?.id === "string" ? entry.id : "";
      if (!id) return null;
      const name =
        typeof entry?.name === "string"
          ? entry.name
          : typeof entry?.description === "string"
            ? entry.description
            : undefined;
      const provider = typeof id === "string" && id.includes("/") ? id.split("/")[0] : null;
      return { id, label: name, provider };
    })
    .filter((entry: any): entry is OpenRouterModelEntry => Boolean(entry));

  models.sort((a, b) => {
    const aKey = (a.label || a.id).toLowerCase();
    const bKey = (b.label || b.id).toLowerCase();
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
  });

  return models;
};

export const OPENROUTER_DEFAULT_BASE_URL = OPENROUTER_BASE_URL;


