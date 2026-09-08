import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { INVESTIGATION_PLAYBOOK_SYSTEM_PROMPT } from "@/lib/investigationPlaybookPrompt";
import { buildInvestigationTopicHints } from "@/lib/investigationTopicHints";

/**
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {string} datacenter
 * @param {string} playbookContext
 * @param {string} apiKey
 * @param {string} model
 */
export async function claudeInvestigationPlaybookSummary({
  ticketId,
  rows,
  datacenter,
  playbookContext,
  apiKey,
  model,
}) {
  const topicHints = buildInvestigationTopicHints(playbookContext);

  const userContent = `Prepare a short cadence-call briefing for Zendesk ticket **#${ticketId}**.

**Report datacenter:** ${datacenter}
${topicHints}

Your reply MUST begin with exactly:
## Investigation Summary — Ticket #${ticketId}

Then exactly the four sections from your system prompt — **Context**, **Current Status**, **Next Steps**, **Customer Temperature** — nothing else. If an EXISTING TLDR block appears in the evidence below and is marked CURRENT, base your summary on it rather than re-deriving from scratch. Do **not** include a Recommended Customer Reply, draft response, or any Zendesk reply section.

--- EVIDENCE ---
${playbookContext}
`;

  const body = {
    model: model || "claude-sonnet-4-5-20250929",
    max_tokens: 12_000,
    temperature: 0.2,
    system: INVESTIGATION_PLAYBOOK_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
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
      180_000
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  const raw = await res.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, message: raw.slice(0, 600), status: res.status };
  }

  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message)) || raw.slice(0, 600) || res.statusText;
    return { ok: false, message: String(msg), status: res.status };
  }

  const parts = Array.isArray(json.content) ? json.content : [];
  const text = parts
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    return { ok: false, message: "Claude returned an empty response.", status: 502 };
  }

  return { ok: true, text: text.trim() };
}
