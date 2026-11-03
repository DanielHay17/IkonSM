import { api } from "../api";
import { BriefCard } from "../components/BriefCard";
import { PageHeader } from "../components/Card";
import { ChatPanel } from "../components/ChatPanel";
import { useBrief } from "../hooks/useBrief";
import { useSession } from "../providers/SessionProvider";

const SUGGESTIONS = [
  "What needs my attention today?",
  "Which buildings have open water leaks?",
  "Summarise pending approvals",
  "Any statutory deadlines coming up?",
];

/** The portfolio-level agent: the morning brief plus cross-building questions. */
export function ChiefOfStaffPage() {
  const { session } = useSession();
  const brief = useBrief();

  return (
    <>
      <PageHeader
        title="Chief of Staff"
        description="Sits above the building agents: watches every inbox, writes the morning brief and answers questions across the portfolio."
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <BriefCard
          brief={brief.brief}
          loading={brief.loading}
          error={brief.error}
          onRetry={brief.reload}
          onRefreshed={brief.setBrief}
        />
        <ChatPanel
          title="Ask the Chief of Staff"
          description="Cross-building questions, open items and priorities. It reads each building's records; it cannot send anything."
          assistantName="the Chief of Staff"
          intro="Ask across all 16 buildings: open emergencies, approvals waiting, deadlines and what each building agent has been doing."
          resourceKey="cos-chat"
          load={api.cosChat}
          send={api.sendCosChat}
          reset={api.resetCosChat}
          suggestions={SUGGESTIONS}
          aiOnline={session.aiOnline}
          refreshKey={brief.refreshKey}
          className="h-[min(760px,calc(100dvh-200px))] min-h-[540px]"
        />
      </div>
    </>
  );
}
