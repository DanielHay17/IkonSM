import { api } from "../../api";
import { ChatPanel } from "../../components/ChatPanel";
import { useBuilding } from "./BuildingContext";

const SUGGESTIONS = [
  "Where is the water main?",
  "Who is our after-hours plumber?",
  "Summarise open issues",
  "What does our insurance cover for water damage?",
];

export function AgentTab() {
  const { propertyId, profile, aiOnline, refreshKey, live } = useBuilding();
  const name = `the SP ${profile.spNumber} agent`;

  return (
    <ChatPanel
      title={`Chat with the SP ${profile.spNumber} agent`}
      description="It searches this building's vault, contacts and work orders, cites its sources, and can draft replies or create work orders. Drafts always wait for approval."
      assistantName={name}
      intro="Answers come from this building's documents, contacts and records, with sources cited. It can draft replies for approval but never sends anything itself."
      resourceKey={`chat:${propertyId}`}
      load={() => api.chat(propertyId)}
      send={(text) => api.sendChat(propertyId, text)}
      reset={() => api.resetChat(propertyId)}
      suggestions={SUGGESTIONS}
      aiOnline={aiOnline}
      refreshKey={refreshKey}
      busyLabel={live?.busy.active ? live.busy.label : null}
      propertyId={propertyId}
      className="h-[min(760px,calc(100dvh-180px))] min-h-[560px]"
    />
  );
}
