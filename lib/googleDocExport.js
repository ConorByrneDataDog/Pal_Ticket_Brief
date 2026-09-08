import { zendeskAgentTicketsBaseFromEnv } from "@/lib/zendeskTicketFetch";

const SECTION_PREFIX = "── ";
const SECTION_SUFFIX = " ──";
const DOC_FONT_SIZE_PT = 11;
const SHARE_DOMAIN = "datadoghq.com";

function dateMarker(date = new Date()) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function zendeskTicketUrl(ticketId) {
  const base = zendeskAgentTicketsBaseFromEnv() || "https://datadog.zendesk.com/agent/tickets";
  return `${base}/${ticketId}`;
}

function splitBriefTldr(text) {
  if (!text) return [null, null];
  let issue = null;
  let status = null;
  for (const raw of text.split("\n")) {
    const ln = raw.trim().replace(/^[•\-*\s]+/, "").trim();
    if (!ln) continue;
    const low = ln.toLowerCase();
    if (low.startsWith("issue:")) issue = ln.slice(ln.indexOf(":") + 1).trim() || null;
    else if (low.startsWith("status:")) status = ln.slice(ln.indexOf(":") + 1).trim() || null;
  }
  return [issue, status];
}

/**
 * Build (fullText, segments) for today's section, grouped by whatever status
 * labels `groupTicketsByStatus()` already produced — no fixed status taxonomy.
 *
 * @param {{ statusLabel: string, tickets: Record<string, string>[] }[]} statusGroups
 * @param {string} dateStr
 * @param {Record<string, string>} [tldrs] — ticketId -> short "Issue: / Status:" text
 */
function buildDailySection(statusGroups, dateStr, tldrs = {}) {
  const segments = [[`${SECTION_PREFIX}${dateStr}${SECTION_SUFFIX}\n`, "heading2"]];

  for (const group of statusGroups) {
    if (!group.tickets.length) continue;
    segments.push([`${group.tickets.length} ${group.statusLabel}\n`, "bold"]);
    for (const t of group.tickets) {
      const ticketId = t.ticketId || "";
      const url = zendeskTicketUrl(ticketId);
      const subject = t.ticketSubject || "(no subject)";
      segments.push([`#${ticketId} ${subject}\n`, "ticket_link", url]);
      const tldr = tldrs[ticketId];
      if (tldr) {
        const [issue, status] = splitBriefTldr(tldr);
        if (issue && status) {
          segments.push([`• Issue: ${issue}\n`, "indented"]);
          segments.push([`• Status: ${status}\n\n`, "indented"]);
        } else {
          segments.push([`${tldr}\n\n`, "indented"]);
        }
      } else {
        segments.push(["\n", "normal"]);
      }
    }
  }
  segments.push(["\n", "normal"]);

  const fullText = segments.map((s) => s[0]).join("");
  return { fullText, segments };
}

function fontSizeRequest(start, end, sizePt = DOC_FONT_SIZE_PT) {
  return {
    updateTextStyle: {
      range: { startIndex: start, endIndex: end },
      textStyle: { fontSize: { magnitude: sizePt, unit: "PT" } },
      fields: "fontSize",
    },
  };
}

function formatRequests(segments, insertIndex) {
  const requests = [];
  let offset = insertIndex;
  for (const [text, style, meta] of segments) {
    const start = offset;
    const end = offset + text.length;
    if (style === "heading2") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: { namedStyleType: "HEADING_2" },
          fields: "namedStyleType",
        },
      });
    } else if (style === "bold") {
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end - 1 },
          textStyle: { bold: true },
          fields: "bold",
        },
      });
    } else if (style === "ticket_link") {
      const visibleLen = text.replace(/\n$/, "").length;
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + visibleLen },
          textStyle: {
            link: { url: meta || "" },
            foregroundColor: { color: { rgbColor: { red: 0.07, green: 0.36, blue: 0.73 } } },
            underline: true,
          },
          fields: "link,foregroundColor,underline",
        },
      });
    } else if (style === "indented") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: end },
          paragraphStyle: {
            indentStart: { magnitude: 28, unit: "PT" },
            indentFirstLine: { magnitude: 28, unit: "PT" },
          },
          fields: "indentStart,indentFirstLine",
        },
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: end - 1 },
          textStyle: {
            italic: true,
            foregroundColor: { color: { rgbColor: { red: 0.35, green: 0.35, blue: 0.35 } } },
          },
          fields: "italic,foregroundColor",
        },
      });
    }
    offset = end;
  }
  return requests;
}

/** @returns {{start:number,end:number,text:string}[]} */
function paraElements(doc) {
  const out = [];
  for (const elem of doc.body?.content || []) {
    if (!elem.paragraph) continue;
    const text = (elem.paragraph.elements || [])
      .map((r) => r.textRun?.content || "")
      .join("");
    out.push({ start: elem.startIndex, end: elem.endIndex, text });
  }
  return out;
}

function firstSectionStart(paras, docEnd) {
  for (const p of paras) {
    if (p.text.startsWith(SECTION_PREFIX) && p.text.includes(SECTION_SUFFIX)) return p.start;
  }
  return docEnd;
}

/**
 * Create (if needed) and update the Google Doc for a PAL account with today's
 * ticket breakdown. Mirrors the PAL Ticket Checker's write_to_google_doc.
 *
 * @param {{ docs: import("googleapis").docs_v1.Docs, drive: import("googleapis").drive_v3.Drive }} clients
 * @param {string | null} docId — existing doc id, or null to create a new one
 * @param {string} accountName
 * @param {{ statusLabel: string, tickets: Record<string, string>[] }[]} statusGroups
 * @param {Record<string, string>} [tldrs]
 * @returns {Promise<string>} the doc id (new or existing)
 */
export async function writeAccountTicketsToGoogleDoc(clients, docId, accountName, statusGroups, tldrs = {}) {
  const { docs, drive } = clients;
  const today = dateMarker();

  const isNew = !docId;
  if (isNew) {
    const created = await docs.documents.create({ requestBody: { title: `${accountName} Tickets` } });
    docId = created.data.documentId;
    await drive.permissions.create({
      fileId: docId,
      sendNotificationEmail: false,
      requestBody: { type: "domain", domain: SHARE_DOMAIN, role: "reader", allowFileDiscovery: false },
    });
  }

  const doc = (await docs.documents.get({ documentId: docId })).data;
  const paras = paraElements(doc);
  const docEnd = doc.body.content[doc.body.content.length - 1].endIndex - 1;

  const { fullText: dailyText, segments: dailySegments } = buildDailySection(statusGroups, today, tldrs);

  if (isNew) {
    const titleText = `${accountName}\n`;
    const notesText = "Notes:\n\n\n\n";
    const fullInit = titleText + notesText + dailyText;

    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: fullInit } }] },
    });

    const fmt = [
      {
        updateParagraphStyle: {
          range: { startIndex: 1, endIndex: 1 + titleText.length },
          paragraphStyle: { namedStyleType: "HEADING_1" },
          fields: "namedStyleType",
        },
      },
      {
        updateTextStyle: {
          range: { startIndex: 1 + titleText.length, endIndex: 1 + titleText.length + "Notes:".length },
          textStyle: { bold: true },
          fields: "bold",
        },
      },
      ...formatRequests(dailySegments, 1 + titleText.length + notesText.length),
      fontSizeRequest(1, 1 + fullInit.length),
    ];
    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: fmt } });
    return docId;
  }

  // Always prepend — never delete or replace anything, even on a repeat same-day export.
  // Insertion point is the top of the current topmost dated section, floored so it can
  // never land at or above the "Notes:" paragraph (which would touch the Heading/Notes block).
  const notesPara = paras.find((p) => p.text.trim().startsWith("Notes:"));
  const safeFloor = notesPara ? notesPara.end : (paras[0]?.end ?? 1);
  let insertAt = firstSectionStart(paras, docEnd);
  if (insertAt < safeFloor) insertAt = safeFloor;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests: [{ insertText: { location: { index: insertAt }, text: dailyText } }] },
  });

  const fmt = [...formatRequests(dailySegments, insertAt), fontSizeRequest(insertAt, insertAt + dailyText.length)];
  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests: fmt } });

  return docId;
}
