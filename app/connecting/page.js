"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

const DC_DISPLAY_ORDER = ["US1", "US3", "US5", "EU1", "AP1", "AP2"];

function ConnectingInner() {
  const params = useSearchParams();
  const dc = params.get("dc") || "";
  const returnTo = params.get("returnTo") || "/";
  const done = useMemo(
    () => new Set((params.get("done") || "").split(",").filter(Boolean)),
    [params]
  );

  const nextStartHref = useMemo(() => {
    const url = new URL("/api/pal-portfolio/supportdog/oauth/start", window.location.origin);
    url.searchParams.set("datacenter", dc);
    url.searchParams.set("connectAll", "1");
    url.searchParams.set("returnTo", returnTo);
    return url.toString();
  }, [dc, returnTo]);

  useEffect(() => {
    if (!dc) return;
    const t = setTimeout(() => {
      window.location.href = nextStartHref;
    }, 900);
    return () => clearTimeout(t);
  }, [dc, nextStartHref]);

  const doneCount = done.size;
  const total = DC_DISPLAY_ORDER.length;

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "4rem auto",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>Connecting SupportDog regions</h1>
      <p style={{ color: "#666", marginBottom: "1.25rem" }}>
        {doneCount}/{total} connected — sending you to authorize <strong>{dc}</strong> next…
      </p>
      <ul style={{ listStyle: "none", padding: 0, textAlign: "left", display: "inline-block" }}>
        {DC_DISPLAY_ORDER.map((region) => {
          const isDone = done.has(region);
          const isCurrent = region === dc;
          return (
            <li
              key={region}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.25rem 0",
                opacity: isDone || isCurrent ? 1 : 0.45,
              }}
            >
              <span aria-hidden>{isDone ? "✅" : isCurrent ? "🔄" : "⏳"}</span>
              <span>{region}</span>
              <span style={{ color: "#888", fontSize: "0.85rem" }}>
                {isDone ? "connected" : isCurrent ? "authorizing…" : "waiting"}
              </span>
            </li>
          );
        })}
      </ul>
      <p style={{ marginTop: "1.25rem" }}>
        <a href={nextStartHref} style={{ color: "#2563eb" }}>
          Continue now
        </a>
      </p>
    </div>
  );
}

export default function ConnectingPage() {
  return (
    <Suspense fallback={null}>
      <ConnectingInner />
    </Suspense>
  );
}
