/**
 * GEMINI_API_KEY plus optional GEMINI_API_KEY_2..4 (or comma-separated
 * GEMINI_API_KEYS). Vercel aliases: vedaa_0 / vedaa0, then vedaa_1 / vedaa1, …
 * On 429 the caller should rotate to the next key.
 */
export function listGeminiApiKeys(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const numbered = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
    env.vedaa_0,
    env.vedaa0,
    env.vedaa_1,
    env.vedaa1,
    env.vedaa_2,
    env.vedaa2,
    env.vedaa_3,
    env.vedaa3,
    env.vedaa_4,
    env.vedaa4,
  ];
  const fromList = (env.GEMINI_API_KEYS ?? "").split(/[,;\n]+/);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of [...numbered, ...fromList]) {
    const key = raw?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function requireGeminiApiKeys(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const keys = listGeminiApiKeys(env);
  if (keys.length === 0) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return keys;
}
