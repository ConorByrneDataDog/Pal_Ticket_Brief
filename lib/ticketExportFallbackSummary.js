import { resolvePalTicketFields } from "@/lib/palExportRow";

/**
 * Minimal investigation-summary markdown when Claude is not available,
 * so the ticket page still shows something useful from the PAL CSV export.
 * @param {string} ticketId
 * @param {Record<string, string>[]} rows
 * @param {string | null} sourcePath
 * @param {{ setupHint?: string, zendeskLiveBlock?: string }} [opts]
 */
export function buildExportFallbackMarkdown(ticketId, rows, sourcePath, opts = {}) {
  const hint = typeof opts.setupHint === "string" && opts.setupHint.trim() ? opts.setupHint.trim() : "";
  const zdLive =
    typeof opts.zendeskLiveBlock === "string" && opts.zendeskLiveBlock.trim() ? opts.zendeskLiveBlock.trim() : "";
  if (!rows?.[0]) {
    return `## Investigation Summary — Ticket #${ticketId}

### Issue Summary

_No matching export row for ticket **#${ticketId}**._

### Current Status
_Not applicable — no matching export row; cannot assess resolution or outcome._
1. Confirm this ticket id exists in your PAL CSV and \`PAL_PORTFOLIO_CSV_PATH\` points at the right file.

### Confidence
**Low** — No export row; cannot assess ticket.

### Sources Used
- **Ticket evidence:** PAL CSV export only (no row for this id)
- **docs.datadoghq.com:** *Not run — no doc body in context*

### Escalation Path

None — fix data source first.`;
  }
  const f = resolvePalTicketFields(rows[0]);

  const parts = [
    `## Investigation Summary — Ticket #${f.ticketId || ticketId}`,
    "",
    "### Issue Summary",
    "",
    `**Export-only stub** — add \`ANTHROPIC_API_KEY\` to \`pal-portfolio/.env.local\` (and restart dev) for a full AI investigation summary.`,
    "",
    `- **Subject:** ${f.ticketSubject || "—"}`,
    "",
    "### Current Status",
    "",
    "_Not available — no model summary ran._",
    "",
    `- **Export status:** ${f.ticketStatus || "Unknown"}`,
    "- No thread in export — cannot assess resolution or outcome",
    "_Configure **Anthropic** and/or **Zendesk API** for live resolution narrative._",
    "",
    "1. Enable full ticket thread (`ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`) for Issue/Resolution sections.",
    "2. Restart `npm run dev` after env changes.",
    "",
    "### Confidence",
    "**Low** — CSV metadata only; no automated investigation.",
    "",
    "### Sources Used",
    "- **Ticket evidence:** PAL CSV export row only",
    "- **docs.datadoghq.com:** *Not run — no doc body in context*",
    "",
    "### Escalation Path",
    "",
    "None — configure AI/Zendesk as needed.",
  ];
  if (zdLive) {
    const cap = 28_000;
    const body = zdLive.length > cap ? `${zdLive.slice(0, cap)}\n\n…_(truncated)_` : zdLive;
    const safe = body.includes("~~~") ? body.replace(/~~~/g, "~~\u200b~~") : body;
    parts.push("", "### Live Zendesk thread (Support API)", "", "_Live thread below was loaded with **Zendesk Support API** — not summarized by the model in this stub._", "", "~~~", safe, "~~~");
  } else {
    parts.push(
      "",
      "_The default engineer PAL CSV has **no** ticket description or comments — set **Zendesk API** in `.env.local` for a live thread._"
    );
  }
  if (hint) {
    parts.push("", `_Setup:_ ${hint.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  if (sourcePath) {
    parts.push("", `_Data file:_ \`${sourcePath}\``);
  }
  return parts.join("\n");
}
