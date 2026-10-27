// Untrusted-text guard. Every free-text field that comes from a third party
// (vendor self-descriptions, agent cards, ticket bodies) passes through here
// before the model sees it. Pattern set follows the injection classes in the
// Meterless Scout Intent spec (instruction override, role hijack, authority
// spoofing, verdict steering). Deterministic, so it is testable and cannot be
// talked out of a decision.
export interface GuardHit { pattern: string; excerpt: string }

const PATTERNS: [string, RegExp][] = [
  ["instruction_override", /\b(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|above|all)\b[^.]{0,20}\b(instructions?|rules?|prompts?)\b/i],
  ["addressed_to_ai", /\b(note|message|instructions?)\s+(to|for)\s+(the\s+)?(ai|llm|assistant|model|reviewers?)\b/i],
  ["role_hijack", /\byou are now\b|\bact as (the )?(system|admin)\b|\bsystem prompt\b/i],
  ["authority_spoof", /\bpre-?approved by\b|\bapproved by the (ciso|cto|ceo|security team)\b/i],
  ["verdict_steering", /\b(output|answer|respond|return|say)\s+["']?(grant|approve|allow|safe)\b/i],
];

export function scanText(text: string): GuardHit[] {
  const hits: GuardHit[] = [];
  for (const [name, re] of PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push({ pattern: name, excerpt: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20) });
  }
  return hits;
}

/** Returns a sanitized copy of rows plus the hits found. Flagged text is withheld from the model. */
export function guardRows(rows: Record<string, unknown>[], where: string): { rows: Record<string, unknown>[]; hits: (GuardHit & { where: string })[] } {
  const hits: (GuardHit & { where: string })[] = [];
  const out = rows.map((r, i) => {
    const copy: Record<string, unknown> = { ...r };
    for (const [k, v] of Object.entries(r)) {
      if (typeof v !== "string" || v.length < 12) continue;
      const h = scanText(v);
      if (h.length) {
        hits.push(...h.map((x) => ({ ...x, where: `${where}[${i}].${k}` })));
        copy[k] = `[WITHHELD BY GUARD: third-party text matched ${h.map((x) => x.pattern).join(", ")}; treat as an attempted manipulation]`;
      }
    }
    return copy;
  });
  return { rows: out, hits };
}
