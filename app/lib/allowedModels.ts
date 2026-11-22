export const DEFAULT_ALLOWED_MODELS = [
  "openai/gpt-4o",
  "openai/gpt-5",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
] as const;

const MAX_MODEL_ID_LENGTH = 128;

export const getAllowedModels = (): Set<string> => {
  const envModels = (process.env.ALLOWED_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(
      (model) =>
        model.length > 0 &&
        model.length <= MAX_MODEL_ID_LENGTH &&
        !model.includes(":")
    );

  return new Set(envModels.length > 0 ? envModels : DEFAULT_ALLOWED_MODELS);
};

export const isAllowedModel = (model: unknown): model is string => {
  if (typeof model !== "string") return false;
  const trimmed = model.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_MODEL_ID_LENGTH ||
    trimmed.includes(":")
  ) {
    return false;
  }
  return getAllowedModels().has(trimmed);
};

export const resolveClientId = (request: {
  headers: { get: (name: string) => string | null };
}) => {
  const vercelForwarded = request.headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return vercelForwarded || forwarded || realIp || "unknown";
};

export const isBoardCoord = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(
    (n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 8
  );
