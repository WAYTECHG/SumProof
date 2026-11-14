// Build-time data loading (server components only). The JSON is produced by
// `python -m sumproof.export_web` from the real evaluation outputs.
import fs from "node:fs";
import path from "node:path";
import type { Dashboard, QuestionSummary, ReceiptRecord } from "./types";

const DATA = path.join(process.cwd(), "public", "data");
const read = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf-8")) as T;

export const loadReceipts = () => read<ReceiptRecord[]>("receipts.json");
export const loadDashboard = () => read<Dashboard>("dashboard.json");
export const loadQuestions = () => read<QuestionSummary[]>("questions.json");
