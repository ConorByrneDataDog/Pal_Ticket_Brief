import { fetchDatadogDocsForTicket, formatDatadogDocsMarkdown } from "@/lib/datadogDocsFetch";
import { formatGithubSourceReviewMarkdown, pickGithubReposForTicket } from "@/lib/githubSourceReview";
import { claudeInvestigationPlaybookSummary } from "@/lib/claudeInvestigationPlaybook";
import { supportdogPlaybookConnectivityMessage } from "@/lib/investigationPlaybookMessages";
import { fetchSupportdogInvestigationContext } from "@/lib/supportdogInvestigationContext";
import { buildExportFactsBlock } from "@/lib/claudeTicketAnalysis";

/**
 * Run investigation-playbook Steps 3–8 and synthesize via Claude (Step 9).
 * @param {object} opts
 * @param {string} opts.ticketId
 * @param {Record<string, string>[]} opts.rows
 * @param {Request | null | undefined} opts.request
 * @param {string} opts.apiKey
 * @param {string} opts.model
 */
export async function runInvestigationPlaybook({ ticketId, rows, request, apiKey, model }) {
  const sd = await fetchSupportdogInvestigationContext(ticketId, null, request);
  const reportDatacenter = sd.resolvedDatacenter || sd.datacenter || "US1";

  const step3 = {
    connected: Boolean(sd.ok),
    datacenter: reportDatacenter,
    queryDatacenter: sd.datacenter || reportDatacenter,
    message: sd.ok
      ? `SupportDog MCP (**supportdog-mcp-${String(sd.datacenter || reportDatacenter).toLowerCase()}**) connected and authenticated.`
      : supportdogPlaybookConnectivityMessage(sd.datacenter || reportDatacenter),
    error: sd.ok ? null : sd.message,
  };

  const exportBlock = buildExportFactsBlock(rows, ticketId);
  const ticketAgeBlock = buildTicketAgeBlock(rows?.[0]?.ticketCreatedTimestamp);

  const docsCorpus = [rows?.[0]?.ticketSubject, rows?.[0]?.primaryProductComponent, exportBlock, sd.rawTicketText || "", sd.markdown || ""]
    .filter(Boolean)
    .join("\n");

  const docsOut = await fetchDatadogDocsForTicket(docsCorpus);
  const docsMarkdown = formatDatadogDocsMarkdown(docsOut.pages);

  const githubRepos = pickGithubReposForTicket(docsCorpus);
  const githubMarkdown = formatGithubSourceReviewMarkdown(githubRepos);

  const playbookContext = buildPlaybookContextMarkdown({
    ticketId,
    reportDatacenter,
    step3,
    step4: sd,
    exportBlock,
    ticketAgeBlock,
    docsMarkdown,
    githubMarkdown,
    existingTldr: sd.existingTldr || null,
  });

  const claude = await claudeInvestigationPlaybookSummary({
    ticketId,
    rows,
    datacenter: reportDatacenter,
    playbookContext,
    apiKey,
    model,
  });

  return {
    sd,
    reportDatacenter,
    step3,
    docsOut,
    githubRepos,
    claude,
    playbookContext,
  };
}

/**
 * Precompute ticket age server-side — don't make the model do date math.
 * @param {string | undefined} createdTimestamp
 */
function buildTicketAgeBlock(createdTimestamp) {
  const raw = String(createdTimestamp || "").trim();
  if (!raw) return "";
  const created = new Date(raw);
  if (Number.isNaN(created.getTime())) return "";
  const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
  return `## Ticket age\nCreated: ${raw} — **${days} day${days === 1 ? "" : "s"} ago** (as of ${new Date().toISOString().slice(0, 10)}).`;
}

/**
 * @param {object} p
 */
function buildPlaybookContextMarkdown(p) {
  const step4Body = p.step4?.ok
    ? `${p.step4.ticketContextSummary || "_Ticket/org summary not generated._"}\n\n${p.step4.markdown || ""}`
    : `_SupportDog Step 4 skipped — ${p.step3.message}_`;

  const tldr = p.existingTldr;
  let existingTldrBlock = "";
  if (tldr?.tldrBody) {
    existingTldrBlock = [
      `## EXISTING TLDR (internal note, written ${tldr.tldrCreatedAt || "unknown time"})`,
      tldr.isCurrent
        ? "**Status: CURRENT** — no public customer comment since this TLDR was written. Use it as the basis of your summary; only add new information the evidence below clearly shows that this TLDR is missing."
        : `**Status: STALE** — customer replied publicly after this TLDR was written (latest customer comment: ${tldr.latestCustomerCommentAt || "unknown"}). Treat it as background only; base the summary on the full evidence below, especially what changed since.`,
      "",
      tldr.tldrBody,
    ].join("\n");
  }

  return [
    `## STEP 3 — SupportDog MCP connectivity`,
    `connected: ${p.step3.connected}`,
    `datacenter (report): ${p.reportDatacenter}`,
    `query_datacenter: ${p.step3.queryDatacenter}`,
    p.step3.message,
    p.step3.error ? `\nError detail: ${p.step3.error}` : "",
    "",
    existingTldrBlock,
    `## STEP 4 — SupportDog ticket and org context`,
    step4Body,
    "",
    `## STEP 6 — docs.datadoghq.com (public documentation excerpts)`,
    p.docsMarkdown,
    "",
    `## STEP 8 — GitHub source review (hints)`,
    p.githubMarkdown,
    "",
    `## PAL CSV export (routing metadata)`,
    p.exportBlock,
    "",
    p.ticketAgeBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
