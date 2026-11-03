// Worker entry point: the Hono app (API + agent websockets), inbound email routing,
// and the two Durable Object agent classes.

import { routeAgentEmail } from "agents";
import { app, ensurePortfolioQuietly } from "./api";
import { createIkonEmailResolver } from "./email/routing";
import { PORTFOLIO_IDS } from "./seed/portfolio";

export { PropertyAgent } from "./agents/property-agent";
export { ChiefOfStaffAgent } from "./agents/chief-of-staff";

const emailResolver = createIkonEmailResolver(() => PORTFOLIO_IDS);

export default {
  fetch: app.fetch,

  // Email Routing: sp<number>@ → that building's PropertyAgent, hub@/cos@ → Chief of Staff.
  // Mail for any other address is rejected so the sender gets a bounce.
  async email(message, env) {
    await ensurePortfolioQuietly(env, `email to ${message.to}`);
    await routeAgentEmail(message, env, {
      resolver: emailResolver,
      onNoRoute: (email) => email.setReject("Unknown recipient"),
    });
  },
} satisfies ExportedHandler<Env>;
