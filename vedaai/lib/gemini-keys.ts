/**
 * GEMINI_API_KEY plus optional GEMINI_API_KEY_2..4 (or comma-separated
 * GEMINI_API_KEYS). On 429 the caller should rotate to the next key.
 */
export function listGeminiApiKeys(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const numbered = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
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
