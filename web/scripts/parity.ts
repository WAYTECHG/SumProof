// Checks that the TypeScript accounting checker agrees with the Python one on every receipt.
// Run: node scripts/parity.ts   (Node 23.6+ runs TypeScript directly)
import fs from "node:fs";
import { check, parseAmount } from "../src/lib/consistency.ts";

type PyCheck = { name: string; passed: boolean; expected: number; found: number };
type Rec = { id: number; pred: Record<string, unknown> | null; checks: PyCheck[] };

const receipts: Rec[] = JSON.parse(fs.readFileSync(new URL("../public/data/receipts.json", import.meta.url), "utf-8"));
let rules = 0;
const mismatches: string[] = [];

for (const r of receipts) {
  if (!r.pred) continue;
  const ts = check(r.pred);
  if (ts.length !== r.checks.length) {
    mismatches.push(`#${r.id}: ${ts.length} rules in TS vs ${r.checks.length} in Python`);
    continue;
  }
  ts.forEach((c, k) => {
    const py = r.checks[k];
    rules++;
    if (c.name !== py.name || c.passed !== py.passed || Math.abs(c.expected - py.expected) > 1e-6 || Math.abs(c.found - py.found) > 1e-6) {
      mismatches.push(`#${r.id} ${py.name}: TS ${JSON.stringify(c)} vs Python ${JSON.stringify(py)}`);
    }
  });
}

const spot: [string, number | null][] = [["60.000", 60000], ["1,234.50", 1234.5], ["Rp 17.500", 17500], ["-60.000", -60000], ["2.00", 2], ["abc", null]];
for (const [s, want] of spot) if (parseAmount(s) !== want) mismatches.push(`parseAmount(${s}) = ${parseAmount(s)}, want ${want}`);

console.log(`compared ${rules} rule results on ${receipts.length} receipts: ${mismatches.length ? `${mismatches.length} MISMATCHES` : "all identical"}`);
mismatches.slice(0, 10).forEach((m) => console.log("  " + m));
process.exit(mismatches.length ? 1 : 0);
