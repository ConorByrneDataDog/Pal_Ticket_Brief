import { extractZendeskTicketAttributes } from "@/lib/supportdogTicketParse";

/** @param {string} html */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic: does this internal note look like a TLDR write-up (vs. an unrelated internal note)? */
function looksLikeTldr(bodyText) {
  if (!bodyText) return false;
  if (/\bTLDR\b/i.test(bodyText)) return true;
  const hasNextSteps = /\bnext steps\b/i.test(bodyText);
  const hasIssue = /\bcustomer'?s? issue\b/i.test(bodyText) || /\bissue\b/i.test(bodyText);
  const hasKeyPoints = /\bkey points\b/i.test(bodyText);
  return hasNextSteps && (hasIssue || hasKeyPoints);
}

/**
 * Look for an existing "TLDR" internal note on the ticket (posted by an agent via
 * the ticket-tldr skill/slash-command) and whether the customer has replied since.
 *
 * @param {unknown} parsed — raw SupportDog GetZendeskTicket payload
 * @returns {{
 *   tldrBody: string | null,
 *   tldrCreatedAt: string | null,
 *   latestCustomerCommentAt: string | null,
 *   isCurrent: boolean,
 * }}
 */
export function findExistingTicketTldr(parsed) {
  const attrs = extractZendeskTicketAttributes(parsed);
  const comments = Array.isArray(attrs?.comments) ? attrs.comments : [];
  const requesterId = typeof attrs?.requester_id === "number" ? attrs.requester_id : null;

  const sorted = [...comments]
    .filter((c) => c && typeof c === "object")
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  let latestCustomerCommentAt = null;
  for (const c of sorted) {
    const isPublic = c.public === true || c.public === "true";
    if (!isPublic) continue;
    const authorId = typeof c.author_id === "number" ? c.author_id : null;
    const isCustomer = requesterId != null && authorId === requesterId;
    if (!isCustomer) continue;
    latestCustomerCommentAt = String(c.created_at || "") || latestCustomerCommentAt;
  }

  let tldrBody = null;
  let tldrCreatedAt = null;
  for (const c of sorted) {
    const isInternal = c.public === false || c.public === "false";
    if (!isInternal) continue;
    const body = stripHtml(typeof c.plain_body === "string" && c.plain_body.trim() ? c.plain_body : c.body || "");
    if (!looksLikeTldr(body)) continue;
    // Latest matching internal note wins (sorted ascending, so keep overwriting).
    tldrBody = body;
    tldrCreatedAt = String(c.created_at || "") || tldrCreatedAt;
  }

  const isCurrent = Boolean(tldrBody) && (!latestCustomerCommentAt || (tldrCreatedAt && tldrCreatedAt >= latestCustomerCommentAt));

  return { tldrBody, tldrCreatedAt, latestCustomerCommentAt, isCurrent };
}
