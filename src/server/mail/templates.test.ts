import { describe, expect, it } from "vitest";

import { bookingCancelledEmail, bookingConfirmedEmail } from "./templates";

const data = {
  to: "ana@example.com",
  customerName: "<script>alert(1)</script>",
  orgName: "Studio & Co",
  serviceName: "Haircut",
  staffName: "Lucía",
  when: "Tue, Mar 10 at 14:30",
  manageUrl: "https://reservo.test/b/studio/manage/abc",
};

describe("email templates", () => {
  it("escapes user-provided values in HTML", () => {
    const email = bookingConfirmedEmail(data);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Studio &amp; Co");
  });

  it("includes the manage link in both parts", () => {
    const email = bookingConfirmedEmail(data);
    expect(email.text).toContain(data.manageUrl);
    expect(email.html).toContain(data.manageUrl);
  });

  it("words cancellations differently depending on who cancelled", () => {
    expect(bookingCancelledEmail(data, "customer").text).toContain("as requested");
    expect(bookingCancelledEmail(data, "business").text).toContain("had to cancel");
  });
});
