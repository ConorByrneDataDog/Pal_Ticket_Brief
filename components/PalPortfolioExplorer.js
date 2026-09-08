"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import InvestigationAnalysisView from "@/components/InvestigationAnalysisView";
import SupportdogLandingAuth from "@/components/SupportdogLandingAuth";
import { buildCustomerReportKpiDashboardUrl } from "@/lib/customerReportMetabaseUrl";
import { buildCustomerCallHighlights } from "@/lib/palPortfolioCallHighlights";
import {
  computeOpenTicketPriority,
  groupTicketsByStatus,
  isClosedTicketStatus,
  isOpenLikeStatus,
  isTerminalTicketStatus,
  ticketCreatedMs,
  ticketSolvedAtMs,
  ticketUpdatedMs,
} from "@/lib/palPortfolioTicketPrioritization";

/** @param {string} categoryId @param {string} ticketId */
function highlightBriefingKey(categoryId, ticketId) {
  return `${categoryId}:${ticketId}`;
}

/** localStorage key for remembering the last-selected PAL engineer on this browser. */
const PAL_EMAIL_STORAGE_KEY = "pp_selected_pal_email";

/** Shown as empty placeholder sections before a PAL engineer/account is selected, so the page
 * has visible structure instead of a blank box — filled in for real once an account is picked. */
const DEFAULT_STATUS_LABELS = ["New", "Open", "Pending", "Hold", "Solved", "Closed"];

/** Pull the Green/Orange/Red Customer Temperature out of a rendered briefing's markdown. */
function parseCustomerTemperature(text) {
  if (!text) return null;
  const m = text.match(/###\s*Customer Temperature\s*\n+\s*(Green|Orange|Red)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

const MS_PER_DAY = 86_400_000;
const NEEDS_ATTENTION_MIN_AGE_DAYS = 7;
const AUTO_BRIEF_CONCURRENCY = 3;

/**
 * @param {{
 *   categoryId: string;
 *   title: string;
 *   items: {
 *     ticketId: string;
 *     subject: string;
 *     reviewReason: string;
 *     frJiraKey?: string | null;
 *     frJiraUrl?: string | null;
 *     status?: string;
 *     assigneeName?: string;
 *     csatComment?: string;
 *   }[];
 *   layout?: "default" | "csat";
 *   agentTicketBase: string | null;
 *   highlightExpandedKey: string | null;
 *   onHighlightBriefingClick: (categoryId: string, ticketId: string) => void | Promise<void>;
 *   rowAnalysisLoadingKey: string | null;
 *   analysisByTicket: Record<string, unknown>;
 * }} props
 */
function HighlightCategory({
  categoryId,
  title,
  items,
  layout = "default",
  agentTicketBase,
  highlightExpandedKey,
  onHighlightBriefingClick,
  rowAnalysisLoadingKey,
  analysisByTicket,
}) {
  if (!items?.length) return null;
  const isCsat = layout === "csat";
  const colCount = isCsat ? 7 : 4;
  return (
    <section className="pp-hl-block">
      <h3>{title}</h3>
      <div className="pp-table-wrap pp-hl-table-wrap">
        <table className="pp-table pp-hl-table">
          <thead>
            <tr>
              <th className="pp-hl-col-show">Show</th>
              <th>Ticket</th>
              <th>Subject</th>
              {isCsat ? (
                <>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>CSAT comment</th>
                </>
              ) : null}
              <th>Why highlighted</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const rowKey = highlightBriefingKey(categoryId, it.ticketId);
              const zd = agentTicketBase ? `${String(agentTicketBase).replace(/\/$/, "")}/${it.ticketId}` : null;
              const briefingOpen = highlightExpandedKey === rowKey;
              const rowAnalysis = analysisByTicket[it.ticketId];
              const ra = rowAnalysis && typeof rowAnalysis === "object" ? rowAnalysis : {};
              const fetchErr = typeof ra.fetchError === "string" ? ra.fetchError : null;
              const dis = ra.disabled === true;
              const msg = typeof ra.message === "string" ? ra.message : "";
              const md = typeof ra.text === "string" ? ra.text : "";
              return (
                <Fragment key={rowKey}>
                  <tr className="pp-hl-table-row">
                    <td className="pp-hl-col-show">
                      <button
                        type="button"
                        className="pp-briefing-toggle"
                        onClick={() => void onHighlightBriefingClick(categoryId, it.ticketId)}
                        aria-expanded={briefingOpen}
                      >
                        {briefingOpen ? "Hide" : "Show"}
                      </button>
                    </td>
                    <td className="pp-nowrap">
                      {zd ? (
                        <a
                          href={zd}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                          title="Open in Zendesk"
                        >
                          #{it.ticketId}
                        </a>
                      ) : (
                        <Link
                          href={`/tickets/${encodeURIComponent(it.ticketId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                        >
                          #{it.ticketId}
                        </Link>
                      )}
                      {it.frJiraUrl ? (
                        <>
                          <br />
                          <a
                            href={it.frJiraUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pp-ticket-link pp-fr-jira"
                            title="Open linked Jira issue"
                          >
                            {it.frJiraKey || "Jira"}
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="pp-hl-subject-cell">{it.subject}</td>
                    {isCsat ? (
                      <>
                        <td className="pp-xs pp-nowrap">{it.status || "—"}</td>
                        <td className="pp-xs">{it.assigneeName || "—"}</td>
                        <td className="pp-hl-csat-cell" title={it.csatComment || ""}>
                          {it.csatComment || "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="pp-hl-reason-cell">{it.reviewReason}</td>
                  </tr>
                  {briefingOpen ? (
                    <tr className="pp-table-expand">
                      <td colSpan={colCount}>
                        <div className="pp-hl-briefing">
                          <InvestigationAnalysisView
                            loading={rowAnalysisLoadingKey === rowKey}
                            loadingTitle="Running investigation playbook (SupportDog)…"
                            loadingHint=""
                            fetchError={fetchErr}
                            disabled={dis}
                            disabledMessage={msg}
                            markdown={dis ? "" : md}
                            showSources={false}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function engineerLabel(row) {
  const name = row.palAssembledName || row.palLiaisonSfName || "";
  const email = row.palLiaisonEmail || "";
  if (name && email) return `${name} (${email})`;
  return email || name || "Unknown";
}

/** @param {{ name: string; datadogOrgId?: string }} account */
function palAccountOptionLabel(account) {
  const name = String(account.name || "").trim() || "—";
  const orgId = String(account.datadogOrgId || "").trim();
  return orgId ? `${name} · org ${orgId}` : name;
}

function formatWhen(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (s.length >= 16) return s.slice(0, 16).replace("T", " ");
  return s;
}

function parseTicketMs(row) {
  const s = row?.ticketCreatedTimestamp;
  if (!s) return null;
  const t = new Date(String(s)).getTime();
  return Number.isNaN(t) ? null : t;
}

function toYyyyMmDd(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 0, 0, 0, 0).getTime();
}

function endOfDayLocal(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, mo, da] = parts;
  return new Date(y, mo - 1, da, 23, 59, 59, 999).getTime();
}

function ticketInDateRange(row, rangeFrom, rangeTo) {
  const ms = parseTicketMs(row);
  if (ms == null) return false;
  const fromMs = rangeFrom ? startOfDayLocal(rangeFrom) : null;
  const toMs = rangeTo ? endOfDayLocal(rangeTo) : null;
  if (fromMs != null && ms < fromMs) return false;
  if (toMs != null && ms > toMs) return false;
  return true;
}

const MS_DAY = 86400000;
const CLOSED_VISIBLE_DAYS = 30;

/**
 * Solved / closed / merged rows only if solved/updated (or created if no other date) falls in the trailing
 * {@link CLOSED_VISIBLE_DAYS} days ending on the selected **To** date. Open / pending / etc. are always kept.
 * @param {Record<string, string>} row
 * @param {string} rangeToYyyyMmDd
 */
function terminalTicketInRecentCloseWindow(row, rangeToYyyyMmDd) {
  if (!isTerminalTicketStatus(row.ticketStatus)) return true;
  const endMs = endOfDayLocal(rangeToYyyyMmDd);
  if (endMs == null) return true;
  const cutoff = endMs - CLOSED_VISIBLE_DAYS * MS_DAY;
  const solved = ticketSolvedAtMs(row);
  const updated = ticketUpdatedMs(row);
  const created = ticketCreatedMs(row);
  const anchor = solved ?? updated;
  if (anchor != null) return anchor >= cutoff && anchor <= endMs;
  if (created != null) return created >= cutoff;
  return true;
}

/**
 * @param {{ agentTicketBase: string | null }} props
 */
export default function PalPortfolioExplorer({ agentTicketBase }) {
  const [rows, setRows] = useState([]);
  const [sourcePath, setSourcePath] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSnowflakeSync, setLastSnowflakeSync] = useState(null);
  const [palEmail, setPalEmail] = useState("");
  const [accountId, setAccountId] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [showClosedTickets, setShowClosedTickets] = useState(false);

  const [expandedTicketId, setExpandedTicketId] = useState(null);
  /** Highlights only: `${categoryId}:${ticketId}` so Show in one section does not expand others. */
  const [highlightExpandedKey, setHighlightExpandedKey] = useState(null);
  const [analysisByTicket, setAnalysisByTicket] = useState({});
  const [rowAnalysisLoadingId, setRowAnalysisLoadingId] = useState(null);
  const [rowAnalysisLoadingKey, setRowAnalysisLoadingKey] = useState(null);
  const [needsAttentionBriefingProgress, setNeedsAttentionBriefingProgress] = useState({ total: 0, done: 0 });
  /** Resolved via Zendesk API when export did not contain FR-#### (see `/api/pal-portfolio/call-prep/resolve-fr-jira`). */
  const [frJiraByTicket, setFrJiraByTicket] = useState({});
  const [csatHighlights, setCsatHighlights] = useState({
    loading: false,
    configured: false,
    bad: [],
    good: [],
    error: null,
  });
  const [accountDocs, setAccountDocs] = useState({});
  const [googleDocsConfigured, setGoogleDocsConfigured] = useState(true);
  const [googleSignedIn, setGoogleSignedIn] = useState(false);
  const [googleEmail, setGoogleEmail] = useState(null);
  const [exportingDoc, setExportingDoc] = useState(false);
  const [includeTldrsOnExport, setIncludeTldrsOnExport] = useState(true);
  const [exportError, setExportError] = useState(null);
  const [exportNotice, setExportNotice] = useState(null);
  const selectionRef = useRef({ palEmail: "", accountId: "" });
  selectionRef.current = { palEmail, accountId };

  const loadPortfolioData = useCallback(async ({ isRefresh = false, syncSnowflake = false } = {}) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      if (syncSnowflake) {
        const sfRes = await fetch("/api/pal-portfolio/refresh-from-snowflake", {
          method: "POST",
          cache: "no-store",
        });
        const sfData = await sfRes.json();
        if (!sfRes.ok) {
          throw new Error(sfData.error || `Snowflake export failed (HTTP ${sfRes.status})`);
        }
        if (sfData.exportedAt) setLastSnowflakeSync(sfData.exportedAt);
        if (sfData.sourcePath) setSourcePath(sfData.sourcePath);
      }

      const res = await fetch("/api/pal-portfolio", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.hint || `HTTP ${res.status}`);
      const newRows = Array.isArray(data.rows) ? data.rows : [];
      setRows(newRows);
      setSourcePath(data.sourcePath || null);

      if (isRefresh) {
        const { palEmail: curPal, accountId: curAcct } = selectionRef.current;
        let nextPal = curPal;
        let nextAcct = curAcct;
        if (curPal && !newRows.some((r) => r.palLiaisonEmail === curPal)) {
          nextPal = "";
          nextAcct = "";
        } else if (
          curAcct &&
          !newRows.some((r) => r.palLiaisonEmail === curPal && r.salesforceAccountId === curAcct)
        ) {
          nextAcct = "";
        }
        setPalEmail(nextPal);
        setAccountId(nextAcct);
        setExpandedTicketId(null);
        setHighlightExpandedKey(null);
        setAnalysisByTicket({});
        setRowAnalysisLoadingId(null);
        setRowAnalysisLoadingKey(null);
        setCommentSentimentByTicket({});
        setFrJiraByTicket({});
        setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshPortfolioData = useCallback(
    () => loadPortfolioData({ isRefresh: true, syncSnowflake: true }),
    [loadPortfolioData]
  );

  const loadAccountDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/pal-portfolio/account-docs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      setGoogleDocsConfigured(Boolean(data.configured));
      setGoogleSignedIn(Boolean(data.signedIn));
      setGoogleEmail(data.email || null);
      setAccountDocs(data.docs && typeof data.docs === "object" ? data.docs : {});
    } catch {
      /* non-fatal — export button will surface a fresh error on click */
    }
  }, []);

  useEffect(() => {
    void loadAccountDocs();
  }, [loadAccountDocs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthOk = params.get("google_oauth") === "ok";
    const oauthErr = params.get("google_oauth_error");
    if (!oauthOk && !oauthErr) return;
    if (oauthErr) setExportError(`Google sign-in failed: ${oauthErr}`);
    params.delete("google_oauth");
    params.delete("google_oauth_error");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    void loadAccountDocs();
  }, [loadAccountDocs]);

  const handleExportToDoc = useCallback(async () => {
    if (!accountId) return;
    setExportingDoc(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const res = await fetch("/api/pal-portfolio/export-to-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesforceAccountId: accountId, includeTldrs: includeTldrsOnExport }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadAccountDocs();
      const errCount = Object.keys(data.tldrErrors || {}).length;
      let notice = `Google Doc updated for ${data.accountName}.`;
      if (data.tldrsGenerated > 0) notice += ` Added ${data.tldrsGenerated} TLDR${data.tldrsGenerated === 1 ? "" : "s"}.`;
      if (errCount > 0) notice += ` (${errCount} TLDR${errCount === 1 ? "" : "s"} skipped — see console.)`;
      if (errCount > 0) console.warn("Export TLDR errors:", data.tldrErrors);
      setExportNotice(notice);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingDoc(false);
    }
  }, [accountId, includeTldrsOnExport, loadAccountDocs]);

  useEffect(() => {
    setExpandedTicketId(null);
    setHighlightExpandedKey(null);
    setAnalysisByTicket({});
    setRowAnalysisLoadingId(null);
    setRowAnalysisLoadingKey(null);
    setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
  }, [palEmail, accountId]);

  useEffect(() => {
    void loadPortfolioData();
  }, [loadPortfolioData]);

  // Restore the last-selected PAL engineer on this browser, once rows have loaded
  // and only if nothing is already selected (don't clobber an in-progress pick).
  useEffect(() => {
    if (palEmail || !rows.length || typeof window === "undefined") return;
    const saved = window.localStorage.getItem(PAL_EMAIL_STORAGE_KEY);
    if (saved && rows.some((r) => r.palLiaisonEmail === saved)) {
      setPalEmail(saved);
    }
  }, [rows, palEmail]);

  const ticketBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const ms = parseTicketMs(r);
      if (ms == null) continue;
      min = Math.min(min, ms);
      max = Math.max(max, ms);
    }
    if (min === Infinity) return { minStr: "", maxStr: "", minMs: null, maxMs: null };
    return { minStr: toYyyyMmDd(min), maxStr: toYyyyMmDd(max), minMs: min, maxMs: max };
  }, [rows]);

  useEffect(() => {
    if (!rows.length || !ticketBounds.minStr) return;
    setRangeFrom(ticketBounds.minStr);
    setRangeTo(ticketBounds.maxStr);
  }, [rows, ticketBounds.minStr, ticketBounds.maxStr]);

  const applyFullDataRange = useCallback(() => {
    if (ticketBounds.minStr && ticketBounds.maxStr) {
      setRangeFrom(ticketBounds.minStr);
      setRangeTo(ticketBounds.maxStr);
    }
  }, [ticketBounds.minStr, ticketBounds.maxStr]);

  const applyPresetDays = useCallback(
    (days) => {
      if (ticketBounds.maxMs == null) return;
      const end = new Date(ticketBounds.maxMs);
      const start = new Date(ticketBounds.maxMs);
      start.setDate(start.getDate() - (days - 1));
      setRangeFrom(toYyyyMmDd(start.getTime()));
      setRangeTo(toYyyyMmDd(end.getTime()));
    },
    [ticketBounds.maxMs]
  );

  const engineers = useMemo(() => {
    const byEmail = new Map();
    for (const r of rows) {
      const email = r.palLiaisonEmail;
      if (!email || byEmail.has(email)) continue;
      byEmail.set(email, r);
    }
    return [...byEmail.entries()]
      .map(([email, row]) => ({ email, row, label: engineerLabel({ ...row, palLiaisonEmail: email }) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }, [rows]);

  const accountsForPal = useMemo(() => {
    if (!palEmail) return [];
    const byId = new Map();
    for (const r of rows) {
      if (r.palLiaisonEmail !== palEmail) continue;
      const id = r.salesforceAccountId;
      if (!id) continue;
      const orgId = String(r.datadogOrgId || "").trim();
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, {
          id,
          name: r.salesforceAccountName || id,
          zendeskOrgName: r.zendeskOrgName || "",
          datadogOrgId: orgId,
        });
        continue;
      }
      if (!existing.datadogOrgId && orgId) existing.datadogOrgId = orgId;
      if (!existing.zendeskOrgName && r.zendeskOrgName) existing.zendeskOrgName = r.zendeskOrgName;
    }
    return [...byId.values()].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" })
    );
  }, [rows, palEmail]);

  const selectedAccount = useMemo(
    () => accountsForPal.find((a) => a.id === accountId) || null,
    [accountsForPal, accountId]
  );

  const customerKpiDashboardUrl = useMemo(() => {
    if (!selectedAccount?.datadogOrgId) return null;
    return buildCustomerReportKpiDashboardUrl(selectedAccount.datadogOrgId, selectedAccount.zendeskOrgName);
  }, [selectedAccount]);

  const ticketsForAccountRaw = useMemo(() => {
    if (!palEmail || !accountId) return [];
    return rows.filter((r) => r.palLiaisonEmail === palEmail && r.salesforceAccountId === accountId);
  }, [rows, palEmail, accountId]);

  const rangeInvalid = useMemo(() => {
    if (!rangeFrom || !rangeTo) return false;
    const a = startOfDayLocal(rangeFrom);
    const b = endOfDayLocal(rangeTo);
    if (a == null || b == null) return false;
    return a > b;
  }, [rangeFrom, rangeTo]);

  const ticketsForAccount = useMemo(() => {
    if (!palEmail || !accountId || rangeInvalid) return [];
    const list = ticketsForAccountRaw
      .filter((r) => ticketInDateRange(r, rangeFrom, rangeTo))
      .filter((r) => terminalTicketInRecentCloseWindow(r, rangeTo));
    return list.sort((a, b) => String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp)));
  }, [ticketsForAccountRaw, palEmail, accountId, rangeFrom, rangeTo, rangeInvalid]);

  const ticketsForAccountDisplay = ticketsForAccount;

  const hasSelection = Boolean(palEmail && accountId);

  const closedTicketsInRange = useMemo(
    () => ticketsForAccountDisplay.filter((r) => isClosedTicketStatus(r.ticketStatus)),
    [ticketsForAccountDisplay]
  );

  const ticketStatusGroups = useMemo(() => {
    const groups = groupTicketsByStatus(ticketsForAccountDisplay).filter(
      (group) => showClosedTickets || !isClosedTicketStatus(group.statusLabel)
    );
    return groups.map((group) => {
      if (!isOpenLikeStatus(group.statusLabel)) return group;
      return {
        ...group,
        tickets: [...group.tickets].sort((a, b) => {
          const pa = computeOpenTicketPriority(a).score;
          const pb = computeOpenTicketPriority(b).score;
          if (pb !== pa) return pb - pa;
          return String(b.ticketCreatedTimestamp).localeCompare(String(a.ticketCreatedTimestamp));
        }),
      };
    });
  }, [ticketsForAccountDisplay, showClosedTickets]);

  const callWindowTickets = ticketsForAccountDisplay;

  const callHighlights = useMemo(() => buildCustomerCallHighlights(callWindowTickets), [callWindowTickets]);

  /** Active tickets we auto-brief to determine Customer Temperature for the "Needs attention" list. */
  const needsAttentionCandidates = useMemo(
    () => callWindowTickets.filter((r) => !isTerminalTicketStatus(r.ticketStatus) && r.ticketId),
    [callWindowTickets]
  );

  const needsAttentionHighlights = useMemo(() => {
    const nowMs = Date.now();
    const items = [];
    for (const row of needsAttentionCandidates) {
      const ticketId = String(row.ticketId || "").trim();
      if (!ticketId) continue;
      const created = ticketCreatedMs(row);
      const ageDays = created != null ? Math.floor((nowMs - created) / MS_PER_DAY) : null;
      const temperature = parseCustomerTemperature(analysisByTicket[ticketId]?.text);
      const isRed = temperature === "Red";
      const isLongRunning = ageDays != null && ageDays > NEEDS_ATTENTION_MIN_AGE_DAYS;
      if (!isRed && !isLongRunning) continue;
      const subject = String(row.ticketSubject || row.subject || "").trim() || "—";
      const reasons = [];
      if (isRed) reasons.push("Customer Temperature: Red");
      if (isLongRunning) reasons.push(`Open ${ageDays} days`);
      items.push({ ticketId, subject, reviewReason: reasons.join(" · "), isRed, ageDays: ageDays ?? 0 });
    }
    return items.sort((a, b) => b.isRed - a.isRed || b.ageDays - a.ageDays);
  }, [needsAttentionCandidates, analysisByTicket]);

  const frJiraResolveKey = useMemo(() => {
    const need = new Set();
    for (const it of callHighlights.featureRequestsAll) {
      if (!it.frJiraUrl && !it.frJiraKey) need.add(it.ticketId);
    }
    for (const it of callHighlights.openDatadogBugFeatureRequests) {
      if (!it.frJiraUrl && !it.frJiraKey) need.add(it.ticketId);
    }
    return [...need].sort().join(",");
  }, [callHighlights.featureRequestsAll, callHighlights.openDatadogBugFeatureRequests]);

  useEffect(() => {
    if (!frJiraResolveKey) {
      setFrJiraByTicket({});
      return undefined;
    }
    let cancelled = false;
    const ids = frJiraResolveKey.split(",").filter(Boolean).slice(0, 24);
    (async () => {
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/resolve-fr-jira", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: ids }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        const results = data.results && typeof data.results === "object" ? data.results : {};
        setFrJiraByTicket((prev) => {
          const next = { ...prev };
          for (const id of ids) {
            const hit = results[id];
            if (hit && typeof hit === "object" && hit.key && hit.url) next[id] = { key: String(hit.key), url: String(hit.url) };
            else delete next[id];
          }
          return next;
        });
      } catch {
        /* keep prior frJiraByTicket on transient errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frJiraResolveKey]);

  const featureRequestsAllDisplay = useMemo(() => {
    return callHighlights.featureRequestsAll.map((it) => {
      const z = frJiraByTicket[it.ticketId];
      const key = it.frJiraKey || z?.key || null;
      const url = it.frJiraUrl || z?.url || null;
      return { ...it, frJiraKey: key, frJiraUrl: url };
    });
  }, [callHighlights.featureRequestsAll, frJiraByTicket]);

  const openDatadogBugFrDisplay = useMemo(() => {
    return callHighlights.openDatadogBugFeatureRequests.map((it) => {
      const z = frJiraByTicket[it.ticketId];
      const key = it.frJiraKey || z?.key || null;
      const url = it.frJiraUrl || z?.url || null;
      return { ...it, frJiraKey: key, frJiraUrl: url };
    });
  }, [callHighlights.openDatadogBugFeatureRequests, frJiraByTicket]);

  const csatFetchKey = useMemo(() => {
    if (!hasSelection || rangeInvalid || !rangeFrom || !rangeTo || !selectedAccount?.datadogOrgId) {
      return "";
    }
    return `${selectedAccount.datadogOrgId}|${accountId}|${rangeFrom}|${rangeTo}`;
  }, [hasSelection, rangeInvalid, rangeFrom, rangeTo, selectedAccount?.datadogOrgId, accountId]);

  useEffect(() => {
    if (!csatFetchKey) {
      setCsatHighlights({ loading: false, configured: false, bad: [], good: [], error: null });
      return undefined;
    }
    let cancelled = false;
    const [datadogOrgId, salesforceAccountId, rangeFromKey, rangeToKey] = csatFetchKey.split("|");
    (async () => {
      setCsatHighlights((p) => ({ ...p, loading: true, error: null }));
      try {
        const res = await fetch("/api/pal-portfolio/call-prep/csat-ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datadogOrgId,
            salesforceAccountId,
            rangeFrom: rangeFromKey,
            rangeTo: rangeToKey,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setCsatHighlights({
            loading: false,
            configured: true,
            bad: [],
            good: [],
            error: data.error || data.message || `HTTP ${res.status}`,
          });
          return;
        }
        setCsatHighlights({
          loading: false,
          configured: data.configured === true,
          bad: Array.isArray(data.bad) ? data.bad : [],
          good: Array.isArray(data.good) ? data.good : [],
          error: typeof data.error === "string" ? data.error : null,
        });
      } catch (e) {
        if (!cancelled) {
          setCsatHighlights({
            loading: false,
            configured: false,
            bad: [],
            good: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [csatFetchKey]);

  const callHighlightTotal = useMemo(() => {
    return (
      needsAttentionHighlights.length +
      callHighlights.openDatadogBugFeatureRequests.length +
      csatHighlights.bad.length +
      csatHighlights.good.length
    );
  }, [needsAttentionHighlights, callHighlights, csatHighlights.bad.length, csatHighlights.good.length]);

  function onPalChange(e) {
    const v = e.target.value;
    setPalEmail(v);
    setAccountId("");
    if (typeof window !== "undefined") {
      if (v) window.localStorage.setItem(PAL_EMAIL_STORAGE_KEY, v);
      else window.localStorage.removeItem(PAL_EMAIL_STORAGE_KEY);
    }
  }

  const presetsDisabled = !ticketBounds.maxMs || rangeInvalid;

  const fetchTicketBriefing = useCallback(
    async (ticketId) => {
      const id = String(ticketId);
      const cached = analysisByTicket[id];
      const cachedText = typeof cached?.text === "string" ? cached.text.trim() : "";
      if ((cachedText || cached?.disabled) && !cached?.fetchError) return;
      try {
        const res = await fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(id)}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          credentials: "same-origin",
        });
        const raw = await res.text();
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(
            res.ok
              ? "Server returned invalid JSON."
              : `Request failed (HTTP ${res.status}). ${raw.slice(0, 200).replace(/\s+/g, " ")}`
          );
        }
        if (!res.ok) throw new Error(data.setupHint || data.message || data.error || `HTTP ${res.status}`);
        if (!String(data.text || "").trim() && !data.fetchError && !data.error) {
          throw new Error("Investigation completed but returned an empty summary. Try Show again.");
        }
        setAnalysisByTicket((p) => ({ ...p, [id]: data }));
      } catch (e) {
        setAnalysisByTicket((p) => ({
          ...p,
          [id]: { fetchError: e instanceof Error ? e.message : String(e) },
        }));
      }
    },
    [analysisByTicket]
  );

  // Auto-brief every active ticket for the selected account so "Needs attention" can flag
  // Customer Temperature: Red — this fires one Claude call per un-briefed active ticket.
  useEffect(() => {
    const ids = needsAttentionCandidates.map((r) => String(r.ticketId).trim()).filter(Boolean);
    const pending = ids.filter((id) => !analysisByTicket[id]);
    if (!pending.length) {
      setNeedsAttentionBriefingProgress({ total: ids.length, done: ids.length });
      return undefined;
    }
    let cancelled = false;
    let done = ids.length - pending.length;
    setNeedsAttentionBriefingProgress({ total: ids.length, done });

    (async () => {
      let cursor = 0;
      async function worker() {
        while (!cancelled && cursor < pending.length) {
          const id = pending[cursor++];
          await fetchTicketBriefing(id);
          if (cancelled) return;
          done += 1;
          setNeedsAttentionBriefingProgress({ total: ids.length, done });
        }
      }
      await Promise.all(Array.from({ length: Math.min(AUTO_BRIEF_CONCURRENCY, pending.length) }, worker));
    })();

    return () => {
      cancelled = true;
    };
    // fetchTicketBriefing intentionally omitted — it's re-created per analysisByTicket update,
    // and including it would restart this loop on every single completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAttentionCandidates]);

  const onHighlightBriefingClick = useCallback(
    async (categoryId, ticketId) => {
      const id = String(ticketId);
      const key = highlightBriefingKey(categoryId, id);
      if (highlightExpandedKey === key) {
        setHighlightExpandedKey(null);
        return;
      }
      setHighlightExpandedKey(key);
      setRowAnalysisLoadingKey(key);
      await fetchTicketBriefing(id);
      setRowAnalysisLoadingKey(null);
    },
    [highlightExpandedKey, fetchTicketBriefing]
  );

  const onTableBriefingClick = useCallback(
    async (ticketId) => {
      const id = String(ticketId);
      if (expandedTicketId === id) {
        setExpandedTicketId(null);
        return;
      }
      setExpandedTicketId(id);
      setRowAnalysisLoadingId(id);
      await fetchTicketBriefing(id);
      setRowAnalysisLoadingId(null);
    },
    [expandedTicketId, fetchTicketBriefing]
  );

  return (
    <>
      <div className="pp-sidebar">
        <span className="pp-sidebar-label">PAL &amp; SupportDog</span>
        <div className="pp-sidebar-content">
          <div className="pp-sidebar-section">
            <div className="pp-sidebar-title">SupportDog</div>
            <SupportdogLandingAuth compact />
          </div>

          {!loading && !loadError && rows.length > 0 ? (
            <div className="pp-sidebar-section">
              <div className="pp-sidebar-title">PAL selection</div>
              <div className="pp-field">
                <label htmlFor="pal-engineer" className="pp-label">
                  PAL engineer
                </label>
                <select id="pal-engineer" value={palEmail} onChange={onPalChange} className="pp-select">
                  <option value="">Select a PAL engineer…</option>
                  {engineers.map((e) => (
                    <option key={e.email} value={e.email}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pp-field" style={{ marginTop: "0.75rem" }}>
                <label htmlFor="pal-account" className="pp-label">
                  PAL account (Salesforce)
                </label>
                <select
                  id="pal-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={!palEmail}
                  className="pp-select"
                >
                  <option value="">{palEmail ? "Select an account…" : "Select a PAL engineer first"}</option>
                  {accountsForPal.map((a) => (
                    <option key={a.id} value={a.id}>
                      {palAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
                {selectedAccount?.datadogOrgId ? (
                  <p className="pp-muted" style={{ marginTop: "0.35rem", fontSize: "0.8125rem" }}>
                    Org ID: <strong>{selectedAccount.datadogOrgId}</strong>
                    {customerKpiDashboardUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={customerKpiDashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pp-ticket-link"
                        >
                          KPI summary (Metabase)
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {!loading && !loadError && rows.length > 0 ? (
            <div className="pp-sidebar-section">
              <div className="pp-sidebar-title">Ticket created</div>
              <div className="pp-range-block">
                <p className="pp-section-hint">Default: full CSV date span (local calendar day, inclusive).</p>
                <div className="pp-range-row">
                  <div className="pp-field">
                    <label htmlFor="range-from" className="pp-label">
                      From
                    </label>
                    <input
                      id="range-from"
                      type="date"
                      value={rangeFrom}
                      onChange={(e) => setRangeFrom(e.target.value)}
                      min={ticketBounds.minStr || undefined}
                      max={ticketBounds.maxStr || undefined}
                      className="pp-select"
                    />
                  </div>
                  <div className="pp-field">
                    <label htmlFor="range-to" className="pp-label">
                      To
                    </label>
                    <input
                      id="range-to"
                      type="date"
                      value={rangeTo}
                      onChange={(e) => setRangeTo(e.target.value)}
                      min={ticketBounds.minStr || undefined}
                      max={ticketBounds.maxStr || undefined}
                      className="pp-select"
                    />
                  </div>
                  <button type="button" className="pp-btn pp-btn-primary" onClick={applyFullDataRange}>
                    Full data range
                  </button>
                </div>
                <div className="pp-presets">
                  <span className="pp-presets-label">Quick:</span>
                  <button
                    type="button"
                    className="pp-btn"
                    disabled={presetsDisabled}
                    onClick={() => applyPresetDays(7)}
                  >
                    Last 7 days
                  </button>
                  <button
                    type="button"
                    className="pp-btn"
                    disabled={presetsDisabled}
                    onClick={() => applyPresetDays(30)}
                  >
                    Last 30 days
                  </button>
                  <button
                    type="button"
                    className="pp-btn"
                    disabled={presetsDisabled}
                    onClick={() => applyPresetDays(90)}
                  >
                    Last 90 days
                  </button>
                  <button
                    type="button"
                    className="pp-btn"
                    disabled={presetsDisabled}
                    onClick={() => applyPresetDays(180)}
                  >
                    Last 180 days
                  </button>
                </div>
                {ticketBounds.minStr ? (
                  <p className="pp-section-hint">
                    CSV span: {ticketBounds.minStr} → {ticketBounds.maxStr}
                  </p>
                ) : null}
                {rangeInvalid ? <p className="pp-error">“From” must be on or before “To”.</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pp-wrap">
      <header className="pp-header">
        <h1 className="pp-title">PAL ticket review</h1>
        <div className="pp-data-toolbar">
          {lastSnowflakeSync ? (
            <p className="pp-muted pp-path">
              Last Snowflake sync: {new Date(lastSnowflakeSync).toLocaleString()}
            </p>
          ) : null}
          <button
            type="button"
            className="pp-btn pp-btn-primary"
            onClick={() => void refreshPortfolioData()}
            disabled={loading || refreshing}
            title="Query Snowflake, update the portfolio CSV on disk, then reload the table"
          >
            {refreshing ? "Refreshing…" : "Refresh data"}
          </button>
        </div>
      </header>

      <div className="pp-card">
        {!hasSelection ? (
          <div>
            <h2 className="pp-title" style={{ fontSize: "1.1rem" }}>
              Welcome to the PAL ticket review app
            </h2>
            <p className="pp-section-hint">
              This app helps you prepare for customer cadence calls: review a PAL account's open tickets grouped by
              status, generate an AI briefing for any ticket (issue, current status, next steps, and customer
              temperature), and export the ticket list to a shared Google Doc.
            </p>
            <p className="pp-section-hint">
              Hover the purple bar on the left edge of the page to open the sidebar, pick a{" "}
              <strong>PAL engineer</strong>, then a <strong>PAL account</strong> — the ticket count and status
              breakdown below will fill in once you do.
            </p>
          </div>
        ) : null}

        {loading ? <p className="pp-muted">Loading portfolio…</p> : null}
        {refreshing && !loading ? (
          <p className="pp-muted" style={{ marginBottom: "0.75rem" }}>
            Querying Snowflake and reloading portfolio…
          </p>
        ) : null}
        {loadError ? <p className="pp-error">{loadError}</p> : null}
        {!loading && !loadError && rows.length === 0 ? <p className="pp-muted">No rows in CSV.</p> : null}

        {!loading && !loadError && rows.length > 0 && hasSelection ? (
          <>
            <p className="pp-muted">
              {ticketsForAccount.length} ticket{ticketsForAccount.length !== 1 ? "s" : ""} in range
              {ticketsForAccountRaw.length !== ticketsForAccount.length
                ? ` (${ticketsForAccountRaw.length} total for this account)`
                : ""}
            </p>
            {rangeTo && !rangeInvalid ? (
              <p className="pp-section-hint">
                Default: <strong>closed</strong> hidden; <strong>solved/merged</strong> only if updated within{" "}
                <strong>30 days</strong> of table <strong>To</strong>.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {hasSelection && !rangeInvalid && ticketsForAccount.length > 0 ? (
        <>
          <div className="pp-card pp-call-prep">
            <h2 className="pp-call-prep-title">Customer call prep — highlights</h2>
            <p className="pp-section-hint">
              Needs attention: Customer Temperature is <strong>Red</strong>, or the ticket has been open longer than{" "}
              <strong>{NEEDS_ATTENTION_MIN_AGE_DAYS} days</strong>.
            </p>
            {needsAttentionBriefingProgress.total > 0 &&
            needsAttentionBriefingProgress.done < needsAttentionBriefingProgress.total ? (
              <p className="pp-section-hint">
                Checking customer temperature — briefed {needsAttentionBriefingProgress.done} of{" "}
                {needsAttentionBriefingProgress.total} active tickets…
              </p>
            ) : null}
            {csatHighlights.loading ? (
              <p className="pp-section-hint">Loading CSAT (Snowflake)…</p>
            ) : null}
            {csatHighlights.error && !csatHighlights.loading ? (
              <p className="pp-section-hint">
                CSAT: {csatHighlights.error}
                {!csatHighlights.configured ? " — configure Snowflake MCP (see .env.example)." : null}
              </p>
            ) : null}
            {callWindowTickets.length === 0 ? (
              <p className="pp-hl-empty">No tickets in the export for this account.</p>
            ) : (
              <>
                <HighlightCategory
                  categoryId="needsAttention"
                  title="Needs attention (Red temperature or open >1 week)"
                  items={needsAttentionHighlights}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="csatBad"
                  title="Bad CSAT ratings (Snowflake MCP — satisfaction comment)"
                  items={csatHighlights.bad}
                  layout="csat"
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="csatGood"
                  title="Good CSAT ratings (Snowflake MCP — satisfaction comment)"
                  items={csatHighlights.good}
                  layout="csat"
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                <HighlightCategory
                  categoryId="bugFr"
                  title="Feature requests — open Datadog-side bugs"
                  items={openDatadogBugFrDisplay}
                  agentTicketBase={agentTicketBase}
                  highlightExpandedKey={highlightExpandedKey}
                  onHighlightBriefingClick={onHighlightBriefingClick}
                  rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                  analysisByTicket={analysisByTicket}
                />
                {callHighlights.featureRequestsAll.length > 0 ? (
                  <HighlightCategory
                    categoryId="frAll"
                    title="Feature requests (all in highlights window)"
                    items={featureRequestsAllDisplay}
                    agentTicketBase={agentTicketBase}
                    highlightExpandedKey={highlightExpandedKey}
                    onHighlightBriefingClick={onHighlightBriefingClick}
                    rowAnalysisLoadingKey={rowAnalysisLoadingKey}
                    analysisByTicket={analysisByTicket}
                  />
                ) : null}
                {callHighlightTotal === 0 ? (
                  <p className="pp-hl-empty">No risk highlights in this window (feature requests may still appear).</p>
                ) : null}
              </>
            )}
          </div>

          <div className="pp-tickets-by-status">
          {hasSelection ? (
            <div className="pp-section-hint" style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              {googleDocsConfigured && !googleSignedIn ? (
                <a
                  href={`/api/pal-portfolio/google/oauth/start?returnTo=${encodeURIComponent("/")}`}
                  className="pp-btn pp-btn-secondary"
                >
                  Connect Google to export tickets
                </a>
              ) : googleDocsConfigured ? (
                <>
                  <span className="pp-muted" style={{ fontSize: "0.8125rem" }}>
                    Google: {googleEmail || "connected"}
                  </span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                    <input
                      type="checkbox"
                      checked={includeTldrsOnExport}
                      onChange={(e) => setIncludeTldrsOnExport(e.target.checked)}
                    />
                    Include TLDRs
                  </label>
                  <button
                    type="button"
                    className="pp-btn pp-btn-secondary"
                    onClick={() => void handleExportToDoc()}
                    disabled={exportingDoc}
                    title="Write this account's tickets (grouped by status) to a shared Google Doc"
                  >
                    {exportingDoc ? "Exporting…" : "Export to Google Doc"}
                  </button>
                  {accountDocs[accountId]?.docId ? (
                    <a
                      href={`https://docs.google.com/document/d/${accountDocs[accountId].docId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="pp-btn pp-btn-link"
                    >
                      View Doc ↗
                    </a>
                  ) : null}
                  {exportNotice ? <span className="pp-muted">{exportNotice}</span> : null}
                  {exportError ? <span className="pp-error">{exportError}</span> : null}
                </>
              ) : (
                <span className="pp-muted">
                  Google Doc export not configured — set <code className="pp-code">GOOGLE_SERVICE_ACCOUNT_FILE</code>{" "}
                  in <code className="pp-code">.env.local</code>.
                </span>
              )}
            </div>
          ) : null}
          {closedTicketsInRange.length > 0 ? (
            <p className="pp-section-hint" style={{ marginBottom: "0.5rem" }}>
              {showClosedTickets ? (
                <>
                  <strong>{closedTicketsInRange.length}</strong> closed shown ·{" "}
                  <button type="button" className="pp-btn pp-btn-link" onClick={() => setShowClosedTickets(false)}>
                    Hide closed
                  </button>
                </>
              ) : (
                <>
                  <strong>{closedTicketsInRange.length}</strong> closed hidden (default) ·{" "}
                  <button type="button" className="pp-btn pp-btn-link" onClick={() => setShowClosedTickets(true)}>
                    Show closed
                  </button>
                </>
              )}
            </p>
          ) : null}
          {!hasSelection ? (
            <>
              <p className="pp-section-hint" style={{ marginBottom: "0.75rem" }}>
                Select a PAL engineer and account from the sidebar to load tickets.
              </p>
              {DEFAULT_STATUS_LABELS.map((label) => (
                <section key={label} className="pp-status-section">
                  <h2 className="pp-status-heading">
                    {label} <span className="pp-status-count">(0)</span>
                  </h2>
                </section>
              ))}
            </>
          ) : null}
          {ticketStatusGroups.map((group) => {
            const openSection = isOpenLikeStatus(group.statusLabel);
            const colCount = openSection ? 11 : 9;
            return (
              <section key={group.statusLabel} className="pp-status-section">
                <h2 className="pp-status-heading">
                  {group.statusLabel}{" "}
                  <span className="pp-status-count">({group.tickets.length})</span>
                </h2>
                <div className="pp-table-wrap">
                  <table className="pp-table">
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Created</th>
                        <th>Subject</th>
                        <th>Status</th>
                        <th>Zendesk org</th>
                        <th>Premier</th>
                        <th>Product</th>
                        <th>Impact</th>
                        {openSection ? (
                          <>
                            <th>Attention</th>
                            <th>Signals</th>
                          </>
                        ) : null}
                        <th>Briefing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tickets.map((t) => {
                        const tid = String(t.ticketId);
                        const href = agentTicketBase && tid ? `${agentTicketBase}/${tid}` : null;
                        const briefingOpen = expandedTicketId === tid;
                        const rowAnalysis = analysisByTicket[tid];
                        const pr = openSection ? computeOpenTicketPriority(t) : null;
                        const priorityRowClass =
                          pr && pr.tier !== "low" ? `pp-row-priority-${pr.tier}` : undefined;
                        const signalsTitle = pr?.reasons?.length ? pr.reasons.join("\n") : "";
                        const signalsPreview =
                          pr?.reasons?.length ? pr.reasons.slice(0, 3).join(" · ") : "—";
                        return (
                          <Fragment key={`${t.salesforceAccountId}-${tid}`}>
                            <tr className={priorityRowClass}>
                              <td className="pp-mono">
                                {href ? (
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pp-ticket-link"
                                    title="Open in Zendesk"
                                  >
                                    {tid}
                                  </a>
                                ) : (
                                  <Link
                                    href={`/tickets/${encodeURIComponent(tid)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="pp-ticket-link"
                                    title="Open ticket summary (set ZENDESK_SUBDOMAIN or ZENDESK_AGENT_TICKET_URL_PREFIX for Zendesk links)"
                                  >
                                    {tid}
                                  </Link>
                                )}
                                {href ? (
                                  <>
                                    {" · "}
                                    <Link
                                      href={`/tickets/${encodeURIComponent(tid)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="pp-ticket-link-secondary"
                                    >
                                      Summary
                                    </Link>
                                  </>
                                ) : null}
                              </td>
                              <td className="pp-xs pp-nowrap">{formatWhen(t.ticketCreatedTimestamp)}</td>
                              <td className="pp-subject" title={t.ticketSubject || ""}>
                                {t.ticketSubject || "—"}
                              </td>
                              <td className="pp-cap pp-nowrap">{t.ticketStatus || "—"}</td>
                              <td className="pp-xs pp-truncate" title={t.zendeskOrgName || ""}>
                                {t.zendeskOrgName || "—"}
                              </td>
                              <td className="pp-nowrap">
                                {String(t.isPremierSupportTicket).toLowerCase() === "true" ? "Yes" : "No"}
                              </td>
                              <td className="pp-xs">{t.primaryProductComponent || "—"}</td>
                              <td className="pp-xs pp-cap">{t.ticketImpact || "—"}</td>
                              {openSection ? (
                                <>
                                  <td className="pp-nowrap">
                                    {pr.tier === "high" ? (
                                      <span className="pp-tier-badge pp-tier-high">High</span>
                                    ) : null}
                                    {pr.tier === "medium" ? (
                                      <span className="pp-tier-badge pp-tier-medium">Med</span>
                                    ) : null}
                                    {pr.tier === "low" ? (
                                      <span className="pp-tier-muted" title={`Score ${pr.score}`}>
                                        —
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="pp-xs pp-signals" title={signalsTitle}>
                                    {signalsPreview}
                                  </td>
                                </>
                              ) : null}
                              <td className="pp-nowrap">
                                <button
                                  type="button"
                                  className="pp-briefing-toggle"
                                  onClick={() => void onTableBriefingClick(tid)}
                                  aria-expanded={briefingOpen}
                                >
                                  {briefingOpen ? "Hide" : "Show"}
                                </button>
                              </td>
                            </tr>
                            {briefingOpen ? (
                              <tr className="pp-table-expand">
                                <td colSpan={colCount}>
                                  <div className="pp-briefing-panel">
                                    <InvestigationAnalysisView
                                      loading={rowAnalysisLoadingId === tid}
                                      loadingTitle="Running investigation playbook (SupportDog)…"
                                      loadingHint=""
                                      fetchError={rowAnalysis?.fetchError || null}
                                      disabled={rowAnalysis?.disabled === true}
                                      disabledMessage={rowAnalysis?.message || ""}
                                      markdown={rowAnalysis?.disabled ? "" : rowAnalysis?.text || ""}
                                      showSources={false}
                                    />
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
        </>
      ) : null}

      {hasSelection && rangeInvalid ? (
        <p className="pp-empty">Fix the date range to see tickets.</p>
      ) : null}

      {hasSelection && !rangeInvalid && ticketsForAccount.length === 0 && !loading ? (
        <p className="pp-empty">
          {ticketsForAccountRaw.length > 0
            ? "No tickets in the selected date range for this account. Widen the range or use “Full data range”."
            : "No tickets in the export for this engineer and account."}
        </p>
      ) : null}
      </div>
    </>
  );
}
