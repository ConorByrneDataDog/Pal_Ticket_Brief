import TicketAnalysisClient from "./TicketAnalysisClient";
import { zendeskAgentTicketsBaseFromEnv } from "@/lib/zendeskTicketFetch";

export async function generateMetadata({ params }) {
  const { ticketId } = await params;
  return {
    title: `Ticket ${ticketId} · Summary · PAL ticket review`,
    description: "Ticket export context and Claude-generated PSE-style summary",
  };
}

export default async function TicketAnalysisPage({ params }) {
  const { ticketId } = await params;
  const agentTicketBase = zendeskAgentTicketsBaseFromEnv();

  return (
    <div style={{ padding: "1.5rem clamp(1rem, 3vw, 2rem)" }}>
      <TicketAnalysisClient ticketId={String(ticketId)} agentTicketBase={agentTicketBase} />
    </div>
  );
}
