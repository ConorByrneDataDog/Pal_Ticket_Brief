/** Datadog Zendesk custom field ids (assignee display name, region). */
export const ZENDESK_ASSIGNEE_CUSTOM_FIELD_ID = "9066374898075";
export const ZENDESK_REGION_CUSTOM_FIELD_ID = "9067264153371";

/**
 * @param {unknown[]} users
 * @returns {Record<number, string>}
 */
export function buildZendeskUserNameById(users) {
  /** @type {Record<number, string>} */
  const userNameById = {};
  if (!Array.isArray(users)) return userNameById;
  for (const u of users) {
    if (!u || typeof u !== "object" || typeof u.id !== "number") continue;
    const name =
      (typeof u.name === "string" && u.name.trim()) ||
      [u.email, u.role].filter(Boolean).join(" ") ||
      `user #${u.id}`;
    userNameById[u.id] = name;
  }
  return userNameById;
}

/**
 * Current Zendesk ticket assignee — not PAL liaison, not comment authors.
 * @param {Record<string, unknown> | null | undefined} ticket
 * @param {Record<number, string>} userNameById
 * @returns {{ name: string | null; region: string | null }}
 */
export function resolveZendeskTicketAssignee(ticket, userNameById) {
  if (!ticket || typeof ticket !== "object") return { name: null, region: null };

  let name = null;
  let region = null;

  const assigneeId = ticket.assignee_id;
  if (typeof assigneeId === "number" && userNameById[assigneeId]) {
    name = userNameById[assigneeId];
  }

  const cf = Array.isArray(ticket.custom_fields) ? ticket.custom_fields : [];
  for (const f of cf) {
    if (!f || typeof f !== "object") continue;
    const id = String(f.id ?? "");
    const val = f.value != null ? String(f.value).trim() : "";
    if (!val) continue;
    if (id === ZENDESK_ASSIGNEE_CUSTOM_FIELD_ID && !name) name = val;
    if (id === ZENDESK_REGION_CUSTOM_FIELD_ID) region = val;
  }

  return { name: name || null, region: region || null };
}

/**
 * Parse assignee from our Zendesk API prompt block line.
 * @param {string} block
 * @returns {{ name: string | null; region: string | null }}
 */
export function parseAssigneeFromZendeskApiBlock(block) {
  if (!block || typeof block !== "string") return { name: null, region: null };
  const nameM = block.match(/\*\*Assignee \(Zendesk — current ticket owner\):\*\*\s*(.+)/i);
  const regionM = block.match(/\*\*Assignee region \(custom field\):\*\*\s*(.+)/i);
  const name = nameM ? nameM[1].trim() : null;
  const region = regionM ? regionM[1].trim() : null;
  if (!name || name === "—" || /^unassigned$/i.test(name)) return { name: null, region };
  return { name, region: region && region !== "—" ? region : null };
}

/**
 * Force metadata line assignee to match Zendesk ticket owner when known.
 * @param {string} markdown
 * @param {string} assigneeName
 * @param {string | null} [region]
 */
export function patchInvestigationSummaryAssignee(markdown, assigneeName, region = null) {
  if (!markdown || !assigneeName) return markdown;
  const regionSuffix = region && region !== "Unknown" ? region : "Unknown";
  const replacement = `**Assignee:** ${assigneeName} (${regionSuffix})`;
  const lineRe = /^(\*\*Tier:\*\*[^\n]*\|\s*\*\*Product Area:\*\*[^\n]*\|\s*)\*\*Assignee:\*\*[^\n]*/m;
  if (lineRe.test(markdown)) {
    return markdown.replace(lineRe, `$1${replacement}`);
  }
  return markdown;
}
