// Placeholder entry — replaced by Module E.
export { PropertyAgent } from "./agents/property-agent";
export { ChiefOfStaffAgent } from "./agents/chief-of-staff";
export default { async fetch() { return new Response("ok"); } } satisfies ExportedHandler<Env>;
