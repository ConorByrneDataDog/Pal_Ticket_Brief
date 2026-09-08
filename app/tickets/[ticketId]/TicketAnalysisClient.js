"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import InvestigationAnalysisView from "@/components/InvestigationAnalysisView";
import SupportdogLandingAuth from "@/components/SupportdogLandingAuth";
import { resolvePalTicketFields } from "@/lib/palExportRow";
function formatWhen(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (s.length >= 16) return s.slice(0, 16).replace("T", " ");
  return s;
}

export default function TicketAnalysisClient({ ticketId, agentTicketBase }) {
  const [rows, setRows] = useState([]);
  const [sourcePath, setSourcePath] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const ticketRes = await fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(ticketId)}`);
        const ticketData = await ticketRes.json();
        if (!ticketRes.ok) throw new Error(ticketData.error || `HTTP ${ticketRes.status}`);
        if (cancelled) return;
        setRows(Array.isArray(ticketData.rows) ? ticketData.rows : []);
        setSourcePath(ticketData.sourcePath || null);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const runTicketAnalyze = useCallback(
    async (signal) => {
      const res = await fetch(`/api/pal-portfolio/ticket/${encodeURIComponent(ticketId)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
        signal,
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
      if (!res.ok) {
        const err = new Error(data.message || data.error || `HTTP ${res.status}`);
        if (data.needsSupportdogReconnect) err.needsSupportdogReconnect = true;
        throw err;
      }
      return data;
    },
    [ticketId]
  );

  useEffect(() => {
    if (!rows.length) return undefined;
    if (String(rows[0]?.ticketId || "").trim() !== String(ticketId).trim()) return undefined;

    let cancelled = false;
    const ac = new AbortController();
    const timeoutMs = 300_000;
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    (async () => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      setAnalysis(null);
      try {
        const data = await runTicketAnalyze(ac.signal);
        if (cancelled) return;
        setAnalysis(data);
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(`pp_sd_reconnect_attempted_${ticketId}`);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof Error && e.name === "AbortError") {
          setAnalysisError("The summary request timed out.");
        } else if (e.needsSupportdogReconnect && typeof window !== "undefined") {
          const flagKey = `pp_sd_reconnect_attempted_${ticketId}`;
          if (!window.sessionStorage.getItem(flagKey)) {
            window.sessionStorage.setItem(flagKey, "1");
            setAnalysisError("SupportDog connection failed — reconnecting and retrying…");
            const returnTo = window.location.pathname + window.location.search;
            window.location.href = `/api/pal-portfolio/supportdog/oauth/start?connectAll=1&returnTo=${encodeURIComponent(returnTo)}`;
            return;
          }
          setAnalysisError(`${e.message || String(e)} (already tried reconnecting once — sign in manually below.)`);
        } else {
          setAnalysisError(e.message || String(e));
        }
      } finally {
        clearTimeout(tid);
        if (!cancelled) setAnalysisLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ticketId, rows, runTicketAnalyze]);

  const zdHref = agentTicketBase ? `${agentTicketBase}/${ticketId}` : null;
  const r0 = rows[0];
  const ex = useMemo(() => (r0 ? resolvePalTicketFields(r0) : null), [r0]);

  return (
    <div className="pp-wrap">
      <nav className="pp-muted" style={{ marginBottom: "-0.5rem" }}>
        <Link href="/" className="pp-ticket-link">
          ← PAL ticket review
        </Link>
      </nav>

      <header className="pp-header">
        <h1 className="pp-title">
          Ticket{" "}
          {zdHref ? (
            <a href={zdHref} target="_blank" rel="noopener noreferrer" className="pp-ticket-link" title="Open in Zendesk">
              {ticketId}
            </a>
          ) : (
            ticketId
          )}
        </h1>
        {sourcePath ? <p className="pp-path">Data: {sourcePath}</p> : null}
      </header>

      {loading ? <p className="pp-muted">Loading ticket…</p> : null}
      {error ? <p className="pp-error">{error}</p> : null}

      {!loading && !error && r0 ? (
        <>
          <div className="pp-card" style={{ marginBottom: "1rem" }}>
            <h2 className="pp-label" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Investigation (SupportDog MCP)
            </h2>
            <SupportdogLandingAuth compact />
            <p className="pp-muted" style={{ fontSize: "0.875rem", lineHeight: 1.55, marginTop: "0.75rem", marginBottom: "0.75rem" }}>
              Summaries follow the <strong>investigation-playbook</strong> (SupportDog ticket + org context).
            </p>
          </div>

          <div className="pp-card">
            <h2 className="pp-label" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              From export
            </h2>
            <dl className="pp-dl">
              <div>
                <dt>Subject</dt>
                <dd>{ex?.ticketSubject || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="pp-cap">{ex?.ticketStatus || "—"}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatWhen(ex?.ticketCreatedTimestamp)}</dd>
              </div>
              <div>
                <dt>Salesforce account</dt>
                <dd>{ex?.salesforceAccountName || "—"}</dd>
              </div>
              <div>
                <dt>Zendesk org</dt>
                <dd>{ex?.zendeskOrgName || "—"}</dd>
              </div>
              <div>
                <dt>Product</dt>
                <dd>{ex?.primaryProductComponent || "—"}</dd>
              </div>
              <div>
                <dt>Impact</dt>
                <dd className="pp-cap">{ex?.ticketImpact || "—"}</dd>
              </div>
              <div>
                <dt>PAL context</dt>
                <dd>
                  {(ex?.palAssembledName || ex?.palLiaisonSfName || "—") + " "}
                  {ex?.palLiaisonEmail ? <span className="pp-muted">({ex.palLiaisonEmail})</span> : null}
                </dd>
              </div>
            </dl>
            <div className="pp-actions">
              {zdHref ? (
                <a href={zdHref} target="_blank" rel="noreferrer" className="pp-btn pp-btn-primary">
                  Open in Zendesk
                </a>
              ) : null}
            </div>
          </div>

          {analysis?.supportdogStatus === "error" && analysis?.disabled !== true ? (
            <div
              className="pp-card"
              style={{
                marginBottom: "1rem",
                border: "2px solid #b45309",
                background: "rgba(180, 83, 9, 0.08)",
              }}
            >
              <h2 className="pp-label" style={{ fontSize: "0.8rem", color: "#92400e" }}>
                SupportDog wasn't reachable for this briefing
              </h2>
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: "0.9rem", color: "#451a03" }}>
                The header panel may show all regions as connected, but that only reflects our own session
                bookkeeping — SupportDog access tokens are short-lived, so a session can go stale between
                checks. This briefing ran on export data only.{" "}
                {analysis?.supportdogError ? (
                  <>
                    <br />
                    <code style={{ fontSize: "0.8rem" }}>{analysis.supportdogError}</code>
                  </>
                ) : null}
              </p>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                Use <strong>Test MCP</strong> in the SupportDog panel to verify live connectivity, then re-run this
                briefing.
              </p>
            </div>
          ) : null}

          {analysis?.threadEvidence === "none" && analysis?.disabled !== true ? (
            <div
              className="pp-card"
              style={{
                marginBottom: "1rem",
                border: "2px solid #b45309",
                background: "rgba(180, 83, 9, 0.08)",
              }}
            >
              <h2 className="pp-label" style={{ fontSize: "0.8rem", color: "#92400e" }}>
                Limited conversation text
              </h2>
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: "0.9rem", color: "#451a03" }}>
                The export has routing fields only. Configure <code>ZENDESK_EMAIL</code> + <code>ZENDESK_API_TOKEN</code>{" "}
                for a live Support API thread, or rely on SupportDog ticket/org context above.
              </p>
            </div>
          ) : null}

          <div className="pp-card">
            {analysis?.mode === "export_fallback_no_ai" && analysis?.disabled !== true ? (
              <p className="pp-muted" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.8125rem" }}>
                Export-only stub: set <code>ANTHROPIC_API_KEY</code>, then restart <code>npm run dev</code>.
              </p>
            ) : null}
            {analysis?.zendeskStatus === "not_configured" && analysis?.disabled !== true ? (
              <p className="pp-muted" style={{ marginBottom: "0.75rem", lineHeight: 1.55, fontSize: "0.8125rem" }}>
                Optional: <code>ZENDESK_EMAIL</code> + <code>ZENDESK_API_TOKEN</code> add a live Support API thread.
              </p>
            ) : null}
            <InvestigationAnalysisView
              loading={analysisLoading}
              loadingTitle="Running investigation playbook (SupportDog)…"
              loadingHint="This can take up to a few minutes when Claude runs."
              fetchError={analysisError}
              disabled={analysis?.disabled === true}
              disabledMessage={analysis?.message || ""}
              markdown={analysis?.disabled ? "" : analysis?.text || ""}
              citations={!analysis?.disabled && Array.isArray(analysis?.citations) ? analysis.citations : []}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
