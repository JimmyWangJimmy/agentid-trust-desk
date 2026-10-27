// Claim-level grounding check. For every reason the model gives, pull out the
// concrete tokens it asserts (ticket ids, customer ids, wallet prefixes, numbers)
// and confirm each one literally appears in the evidence that reason cites.
// Unconfirmed tokens are surfaced in the report; nothing is silently trusted.
import type { Evidence } from "./evidence.ts";

export interface Grounding { status: "grounded" | "partially_grounded"; checked: string[]; unverified: string[] }

const ID_RE = /\b(?:[A-Z]{2,4}-\d{3,5}|C-\d{3,5}|0x[0-9a-fA-F]{4,40})\b/g;
const NUM_RE = /(?<![\w.-])\d+(?:[.,]\d+)?(?![\w-])/g;

function haystack(evs: Evidence[]): string {
  const raw = evs.map((e) => `${e.summary} ${e.source} ${JSON.stringify(e.data)}`).join(" ").toLowerCase();
  return raw.replace(/(\d),(\d{3})/g, "$1$2");
}

function numberVariants(n: string): string[] {
  const v = n.replace(/,/g, "");
  const out = new Set([v]);
  const f = Number(v);
  if (Number.isFinite(f)) {
    out.add(String(f));
    if (!Number.isInteger(f)) { out.add(String(Math.round(f * 100))); out.add(f.toFixed(2)); }
    else out.add((f).toFixed(2));
    if (f <= 100) out.add(String(Number((f / 100).toPrecision(6))));   // 31% <-> 0.31, 0.4% <-> 0.004
    if (f <= 1) out.add(String(Math.round(f * 100)));
  }
  return [...out];
}

export function checkGrounding(claim: string, cited: Evidence[]): Grounding {
  const hay = haystack(cited);
  const ids = [...new Set(claim.match(ID_RE) ?? [])];
  const nums = [...new Set((claim.replace(ID_RE, " ").match(NUM_RE) ?? []).filter((n) => !/^[0-4]$/.test(n)))]; // tiny counts are too ambiguous to check
  const unverified: string[] = [];
  for (const id of ids) if (!hay.includes(id.toLowerCase())) unverified.push(id);
  for (const n of nums) if (!numberVariants(n).some((v) => new RegExp(`(?<![\\d.])${v.replace(".", "\\.")}(?![\\d])`).test(hay))) unverified.push(n);
  return { status: unverified.length ? "partially_grounded" : "grounded", checked: [...ids, ...nums], unverified };
}
