import { resolvePalTicketFields, supplementalExportNarrativeLines } from "@/lib/palExportRow";

/**
 * Shared PAL export facts block used by the investigation-playbook Claude synthesis
 * (grounded on CSV export + SupportDog + Zendesk Support API evidence).
 */

/**
 * @param {Record<string, string>[]} rows
 * @param {string} ticketId
 */
export function buildExportFactsBlock(rows, ticketId) {
  if (!rows?.length) return "";
  const f = resolvePalTicketFields(rows[0]);
  const lines = [
    `Zendesk ticket id: ${f.ticketId || ticketId}`,
    `Subject: ${f.ticketSubject || "—"}`,
    `Status: ${f.ticketStatus || "—"}`,
    `Created: ${f.ticketCreatedTimestamp || "—"}`,
    `Salesforce account: ${f.salesforceAccountName || "—"}`,
    `Zendesk org: ${f.zendeskOrgName || "—"}`,
    `Primary product component (export routing): ${f.primaryProductComponent || "—"}`,
    `Impact: ${f.ticketImpact || "—"}`,
    `Premier flag: ${f.isPremierSupportTicket || "—"}`,
    `PAL liaison (portfolio — NOT Zendesk assignee): ${f.palAssembledName || f.palLiaisonSfName || "—"} ${f.palLiaisonEmail ? `(${f.palLiaisonEmail})` : ""}`,
  ];
  if (f.ticketSource) lines.push(`Ticket source (export): ${f.ticketSource}`);
  if (f.requesterEmail || f.submitterName) {
    lines.push(`Requester (export): ${[f.submitterName, f.requesterEmail].filter(Boolean).join(" · ") || "—"}`);
  }
  if (f.assigneeName) lines.push(`Assignee (export CSV column — verify against Zendesk API): ${f.assigneeName}`);
  for (const line of supplementalExportNarrativeLines(f)) {
    lines.push(line);
  }
  if (rows.length > 1) {
    lines.unshift(`(Export has ${rows.length} rows for this ticket id.)`);
  }
  lines.push("");
  lines.push(
    "**CSV limit:** This export does not include Zendesk description or comment bodies — only routing/metadata. Conversation text must come from the Zendesk Support API block and/or SupportDog ticket context when configured."
  );
  return lines.join("\n");
}
