import PalPortfolioExplorer from "@/components/PalPortfolioExplorer";
import { zendeskAgentTicketsBaseFromEnv } from "@/lib/zendeskTicketFetch";

export default function HomePage() {
  const agentTicketBase = zendeskAgentTicketsBaseFromEnv();

  return (
    <div style={{ padding: "1.5rem clamp(1rem, 3vw, 2rem)" }}>
      <PalPortfolioExplorer agentTicketBase={agentTicketBase} />
    </div>
  );
}
