// The branded HTML version of approved emails (sent alongside the text, and shown in the hub's preview).

import { describe, expect, it } from "vitest";
import type { EmailDraft, PropertyProfile } from "../shared/types";
import { renderEmailHtml } from "../shared/email-html";
import { sendApprovedEmail } from "../worker/email/outbound";

const PROPERTY: PropertyProfile = {
  id: "sp-26707",
  spNumber: "26707",
  street: "34 Davies Road",
  suburb: "Claremont",
  state: "WA",
  postcode: "6010",
  lots: 8,
  status: "pilot",
  emailAddress: "sp26707@agent.ikonsm.com.au",
  notes: null,
};

const BODY = [
  "Hi Jane,",
  "",
  "Thanks for letting us know. We're treating this as an emergency.",
  "",
  "Please do the following now, if it is safe to do so:",
  "1. If anyone is in danger, call 000.",
  "2. Turn off the water at the red lever valve in the garage meter box.",
  "",
  "Insurance: damage to the building is claimed through us. <script>alert(1)</script>",
  "",
  "Kind regards,",
  "Strata Management Team | Ikon Strata Management, on behalf of the strata company for SP 26707",
].join("\n");

function render(logoUrl: string | null = "https://hub.example.com/brand/email-logo.png") {
  return renderEmailHtml({
    subject: "Re: Water through my ceiling",
    body: BODY,
    companyName: "Ikon Strata Management",
    property: PROPERTY,
    fromAddress: PROPERTY.emailAddress,
    logoUrl,
  });
}

describe("branded email HTML", () => {
  it("renders paragraphs, a numbered list, a bold label and the signature block", () => {
    const html = render();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<ol");
    expect(html).toMatch(/<li[^>]*>If anyone is in danger, call 000\.<\/li>/);
    expect(html).toContain("<strong>Insurance:</strong>");
    expect(html).toContain(">Strata Management Team</p>");
    expect(html).toContain("On behalf of the strata company for SP 26707, 34 Davies Road, Claremont WA 6010");
    expect(html).toContain('href="mailto:sp26707@agent.ikonsm.com.au"');
    expect(html).toContain('src="https://hub.example.com/brand/email-logo.png"');
  });

  it("escapes everything that came from the draft", () => {
    const html = render();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("uses a text wordmark when there is no logo URL", () => {
    const html = render(null);
    expect(html).not.toContain("<img");
    expect(html).toContain("IKON<span");
  });

  it("is sent alongside the text part when the property is known", async () => {
    const sent: Record<string, unknown>[] = [];
    const env = {
      EMAIL: { send: async (msg: Record<string, unknown>) => (sent.push(msg), { messageId: "<x@ikon>" }) },
      PUBLIC_URL: "https://hub.example.com/",
      COMPANY_NAME: "Ikon Strata Management",
    } as unknown as Env;
    const draft: EmailDraft = { to: "jane.sample@example.com", toName: "Jane Sample", subject: "Re: Water", body: BODY, inReplyTo: null, references: null };
    const result = await sendApprovedEmail(env, {
      fromAddress: PROPERTY.emailAddress,
      fromName: "Ikon Strata Management - SP 26707",
      draft,
      propertyId: PROPERTY.id,
      approvalId: "a1",
      property: PROPERTY,
    });
    expect(result.ok).toBe(true);
    expect(sent[0]!.text).toBe(BODY);
    expect(String(sent[0]!.html)).toContain('src="https://hub.example.com/brand/email-logo.png"');
    // Without the property (older callers) it stays text-only.
    await sendApprovedEmail(env, { fromAddress: PROPERTY.emailAddress, fromName: "x", draft, propertyId: PROPERTY.id, approvalId: "a2" });
    expect(sent[1]!.html).toBeUndefined();
  });
});
