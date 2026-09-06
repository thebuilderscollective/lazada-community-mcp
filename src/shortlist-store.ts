import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProductShortlist } from "./shortlist.js";

export class ShortlistError extends Error {
  constructor(public code: "shortlist_missing" | "shortlist_expired" | "shortlist_consumed", message: string) { super(message); }
}
type Record = { draft: ProductShortlist; consumed: boolean };
/** Access is serialized by the shared daemon; write the consumption marker before touching the cart. */
export class ShortlistStore {
  constructor(private path: string) {}
  private read(): Record[] {
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.records) || data.records.some((r: Record) => !r?.draft?.shortlistId || !Array.isArray(r.draft.groups) || !Number.isFinite(Date.parse(r.draft.expiresAt)) || typeof r.consumed !== "boolean")) throw new Error("Invalid shortlist storage format.");
      return data.records;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Saved comparisons could not be read. Nothing was added. Ask your assistant to inspect local shortlist storage before retrying.");
    }
  }
  private write(records: Record[]) {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    const temp = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, records })); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
    const parent = openSync(dir, "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  save(draft: ProductShortlist) {
    const records = this.read();
    if (records.some(r => r.draft.shortlistId === draft.shortlistId && r.consumed)) throw this.consumed();
    this.write([...records.filter(r => r.draft.shortlistId !== draft.shortlistId), { draft, consumed: false }].slice(-50));
  }
  private consumed() { return new ShortlistError("shortlist_consumed", "This selection was already submitted. Check the cart before trying again; some items may already have been added. No further changes were made."); }
  get(id: string, allowExpired = false): ProductShortlist {
    const record = this.read().find(r => r.draft.shortlistId === id);
    if (!record) throw new ShortlistError("shortlist_missing", "This saved comparison is unavailable. Refresh options to rebuild it and keep matching choices. Nothing was added by this attempt.");
    if (record.consumed) throw this.consumed();
    if (!allowExpired && Date.parse(record.draft.expiresAt) <= Date.now()) throw new ShortlistError("shortlist_expired", "These prices need refreshing. Refresh options, review your choices, then confirm again. Nothing was added.");
    return record.draft;
  }
  consume(id: string) {
    this.get(id);
    const records = this.read();
    records.find(r => r.draft.shortlistId === id)!.consumed = true;
    this.write(records);
  }
}
