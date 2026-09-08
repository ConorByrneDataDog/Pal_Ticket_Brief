import { NextResponse } from "next/server";
import { loadPalPortfolioRows } from "@/lib/palPortfolio";
import { groupTicketsByStatus, isClosedTicketStatus } from "@/lib/palPortfolioTicketPrioritization";
import { getDocForAccount, saveDocForAccount } from "@/lib/palAccountDocStore";
import { writeAccountTicketsToGoogleDoc } from "@/lib/googleDocExport";
import { generateShortTldrsForActiveTickets } from "@/lib/claudeShortTicketTldr";
import { getGoogleClientsForRequest, isGoogleDocsConfigured } from "@/lib/googleDocsClient";
import { attachGoogleSessionCookie } from "@/lib/googleOAuthSession";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Docs export is not configured. Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_COOKIE_SECRET in .env.local.",
      },
      { status: 503 }
    );
  }

  let googleClients;
  try {
    googleClients = await getGoogleClientsForRequest(request);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), needsGoogleSignIn: true }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const salesforceAccountId = String(body?.salesforceAccountId || "").trim();
  const includeTldrs = Boolean(body?.includeTldrs);
  if (!salesforceAccountId) {
    return NextResponse.json({ error: "Missing salesforceAccountId." }, { status: 400 });
  }

  const { rows } = loadPalPortfolioRows();
  const accountRows = rows.filter((r) => r.salesforceAccountId === salesforceAccountId);
  if (!accountRows.length) {
    return NextResponse.json({ error: `No export rows found for account ${salesforceAccountId}.` }, { status: 404 });
  }
  const accountName =
    accountRows[0].zendeskOrgName || accountRows[0].salesforceAccountName || `Account ${salesforceAccountId}`;
  const nonClosedRows = accountRows.filter((r) => !isClosedTicketStatus(r.ticketStatus));

  let tldrs = {};
  let tldrErrors = {};
  if (includeTldrs) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      tldrErrors = { _config: "ANTHROPIC_API_KEY is not configured — TLDRs were skipped." };
    } else {
      const result = await generateShortTldrsForActiveTickets(nonClosedRows, { apiKey });
      tldrs = result.tldrs;
      tldrErrors = result.errors;
    }
  }

  const statusGroups = groupTicketsByStatus(nonClosedRows);
  const existing = getDocForAccount(salesforceAccountId);

  let docId;
  try {
    docId = await writeAccountTicketsToGoogleDoc(
      { docs: googleClients.docs, drive: googleClients.drive },
      existing?.docId || null,
      accountName,
      statusGroups,
      tldrs
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  saveDocForAccount(salesforceAccountId, docId, { accountName });

  const res = NextResponse.json({
    docId,
    accountName,
    tldrsGenerated: Object.keys(tldrs).length,
    tldrErrors,
  });
  attachGoogleSessionCookie(res, googleClients.tokenResponse, googleClients.session.rt, googleClients.session.email);
  return res;
}
