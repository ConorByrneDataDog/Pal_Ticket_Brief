import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { buildExportFactsBlock } from "@/lib/claudeTicketAnalysis";

const SHORT_TLDR_SYSTEM_PROMPT =
  "You write two-line status summaries for internal support ticket exports. " +
  "Given the ticket facts below, output EXACTLY two lines, no more, no less:\n" +
  'Line 1: "Issue: " followed by one concise sentence describing what the customer is asking for or the problem they are hitting.\n' +
  'Line 2: "Status: " followed by one concise sentence describing where things stand and the next step.\n' +
  "Output ONLY those two lines — no preamble, no markdown, no asterisks, no extra prose.";

/**
 * Short 2-line "Issue / Status" TLDR for a single ticket, generated from CSV export
 * facts only (no SupportDog/Zendesk API calls) — cheap enough to run over a whole
 * account's active tickets for a Google Doc export.
 *
 * @param {{ ticketId: string, rows: Record<string, string>[], apiKey: string, model?: string }} args
 * @returns {Promise<{ ok: true, text: string } | { ok: false, message: string }>}
 */
export async function generateShortTicketTldr({ ticketId, rows, apiKey, model }) {
  if (!apiKey) {
    return { ok: false, message: "ANTHROPIC_API_KEY is not configured." };
  }

  const factsBlock = buildExportFactsBlock(rows, ticketId);
  if (!factsBlock) {
    return { ok: false, message: `No export rows found for ticket ${ticketId}.` };
  }

  const body = {
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 300,
    temperature: 0.2,
    system: SHORT_TLDR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `--- TICKET #${ticketId} FACTS ---\n${factsBlock}\n--- END ---` }],
  };

  let res;
  try {
    res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
      45_000
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, message: raw.slice(0, 400) };
  }

  if (!res.ok) {
    const msg = (json && (json.error?.message || json.message)) || raw.slice(0, 400) || res.statusText;
    return { ok: false, message: String(msg) };
  }

  const parts = Array.isArray(json.content) ? json.content : [];
  const text = parts
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!text) {
    return { ok: false, message: "Claude returned an empty response." };
  }

  return { ok: true, text };
}

const ACTIVE_STATUSES = new Set(["new", "open", "pending", "hold"]);
const TLDR_CAP = 25;
const TLDR_CONCURRENCY = 4;

/**
 * Generate short TLDRs for every active-status ticket in a group set, in parallel
 * with a concurrency cap. Mirrors the PAL Ticket Checker's export behavior.
 *
 * @param {Record<string, string>[]} accountRows — all export rows for the account
 * @param {{ apiKey: string, model?: string }} opts
 * @returns {Promise<{ tldrs: Record<string, string>, errors: Record<string, string> }>}
 */
export async function generateShortTldrsForActiveTickets(accountRows, opts) {
  const byTicket = new Map();
  for (const row of accountRows) {
    const id = row.ticketId;
    if (!id) continue;
    if (!byTicket.has(id)) byTicket.set(id, []);
    byTicket.get(id).push(row);
  }

  const targets = [...byTicket.entries()]
    .filter(([, rows]) => ACTIVE_STATUSES.has(String(rows[0]?.ticketStatus || "").toLowerCase()))
    .slice(0, TLDR_CAP);

  const tldrs = {};
  const errors = {};
  if (!targets.length) return { tldrs, errors };

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const [ticketId, rows] = targets[cursor++];
      const result = await generateShortTicketTldr({ ticketId, rows, apiKey: opts.apiKey, model: opts.model });
      if (result.ok) tldrs[ticketId] = result.text;
      else errors[ticketId] = result.message;
    }
  }

  await Promise.all(Array.from({ length: Math.min(TLDR_CONCURRENCY, targets.length) }, worker));
  return { tldrs, errors };
}
