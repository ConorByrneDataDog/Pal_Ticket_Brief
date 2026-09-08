import { NextResponse } from "next/server";
import { runInvestigationPlaybook } from "@/lib/investigationPlaybookOrchestrator";
import { canRunSupportdogInvestigation } from "@/lib/supportdogMcpClient";
import {
  attachSupportdogSessionCookie,
  attachSupportdogSessionForDatacenter,
  isSupportdogOAuthConfigured,
} from "@/lib/supportdogOAuthSession";
import { loadPalPortfolioRows } from "@/lib/palPortfolio";
import { buildExportFallbackMarkdown } from "@/lib/ticketExportFallbackSummary";
import { supportdogPlaybookConnectivityMessage } from "@/lib/investigationPlaybookMessages";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * @param {unknown} data
 * @param {string | null | undefined} supportdogSessionSeal
 * @param {string | null | undefined} supportdogDatacenter
 */
function jsonWithSessionCookies(data, supportdogSessionSeal, supportdogDatacenter) {
  const res = NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  if (supportdogSessionSeal && supportdogDatacenter) {
    attachSupportdogSessionForDatacenter(res, supportdogSessionSeal, supportdogDatacenter);
  } else if (supportdogSessionSeal) {
    attachSupportdogSessionCookie(res, supportdogSessionSeal);
  }
  return res;
}

async function loadMatchesOrError(ticketId) {
  const { path: sourcePath, rows } = loadPalPortfolioRows();
  if (!sourcePath) {
    return { error: NextResponse.json({ error: "PAL portfolio CSV not found" }, { status: 404 }) };
  }
  const matches = rows.filter((r) => String(r.ticketId).trim() === ticketId);
  if (matches.length === 0) {
    return { error: NextResponse.json({ error: "Ticket not found in export" }, { status: 404 }) };
  }
  return { sourcePath, matches };
}

/**
 * GET / POST — investigation-playbook Steps 3–9 (SupportDog + docs + Claude synthesis).
 */
export async function GET(request, ctx) {
  return handleAnalyze(request, ctx);
}

export async function POST(request, ctx) {
  return handleAnalyze(request, ctx);
}

async function handleAnalyze(request, ctx) {
  const resolved = await ctx.params;
  const ticketId = resolved?.ticketId != null ? String(resolved.ticketId).trim() : "";
  if (!ticketId) {
    return NextResponse.json({ error: "Missing ticket id" }, { status: 400 });
  }

  const loaded = await loadMatchesOrError(ticketId);
  if ("error" in loaded) return loaded.error;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-5-20250929";

  const supportdogConfigured = canRunSupportdogInvestigation(request);

  if (!anthropicKey) {
    const hint = supportdogConfigured
      ? "Sign in to SupportDog regions in the header, then set ANTHROPIC_API_KEY for full Step 9 synthesis."
      : supportdogPlaybookConnectivityMessage("EU1");
    return jsonWithSessionCookies(
      {
        disabled: false,
        mode: "export_fallback_no_anthropic",
        ticketId,
        sourcePath: loaded.sourcePath,
        text: buildExportFallbackMarkdown(ticketId, loaded.matches, loaded.sourcePath, { setupHint: hint }),
        citations: [],
        setupHint: hint,
        supportdogStatus: supportdogConfigured ? "configured" : "not_configured",
      },
      null,
      null
    );
  }

  const oauthConfigured = isSupportdogOAuthConfigured();

  const out = await runInvestigationPlaybook({
    ticketId,
    rows: loaded.matches,
    request,
    apiKey: anthropicKey,
    model,
  });

  if (!out.claude.ok) {
    const status = out.claude.status && out.claude.status >= 400 && out.claude.status < 600 ? out.claude.status : 502;
    const res = jsonWithSessionCookies(
      {
        error: "Investigation summary failed",
        message: out.claude.message,
        status: out.claude.status,
        ticketId,
        datacenter: out.reportDatacenter,
        supportdogStatus: out.sd.ok ? "ok" : "error",
      },
      null,
      null
    );
    return new NextResponse(res.body, { status, headers: res.headers });
  }

  // SupportDog is set up in this environment but this fetch failed (whether never signed in,
  // or signed in and it broke) — even after the automatic reconnect-and-retry inside
  // fetchSupportdogInvestigationContext. Surface a hard error instead of silently returning a
  // CSV-only degraded briefing, so the client can reconnect and retry rather than the user
  // reading a quietly-weaker summary without realizing why.
  if (!out.sd.ok && oauthConfigured) {
    const res = jsonWithSessionCookies(
      {
        error: "SupportDog MCP connection failed",
        message: out.sd.reconnectAttempted
          ? `Reconnect attempt also failed: ${out.sd.message}`
          : out.sd.message,
        reconnectAttempted: Boolean(out.sd.reconnectAttempted),
        ticketId,
        datacenter: out.reportDatacenter,
        setupHint: out.step3.message,
        needsSupportdogReconnect: true,
      },
      null,
      null
    );
    return new NextResponse(res.body, { status: 424, headers: res.headers });
  }

  return jsonWithSessionCookies(
    {
      disabled: false,
      mode: out.sd.ok ? "investigation_playbook_supportdog" : "investigation_playbook_partial",
      ticketId,
      sourcePath: loaded.sourcePath,
      datacenter: out.reportDatacenter,
      supportdogQueryDatacenter: out.sd.datacenter || out.reportDatacenter,
      preferredDatacenter: out.sd.preferredDatacenter,
      datacenterMismatch: out.sd.datacenterMismatch || null,
      text: out.claude.text,
      citations: [],
      supportdogStatus: out.sd.ok ? "ok" : "not_configured",
      supportdogError: out.sd.ok ? null : out.sd.message,
      supportdogOrgId: out.sd.orgId || null,
      docsFetched: out.docsOut.pages.filter((p) => p.ok).map((p) => p.url),
      threadEvidence: out.sd.ok ? "full" : "export_only",
      setupHint: out.sd.ok ? null : out.step3.message,
    },
    null,
    null
  );
}
