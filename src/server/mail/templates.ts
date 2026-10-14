import type { EmailMessage } from "./mailer";

/**
 * Plain, inline-styled transactional emails. Every template returns both a
 * text and an HTML part; values are escaped because names and notes come from
 * the public booking form.
 */

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escape(cta.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e4e4e7">
<p style="margin:0 0 24px;font-weight:700;color:#4f46e5;letter-spacing:-0.01em">Slotsmith</p>
<h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
${bodyHtml}${button}
</div>
<p style="font-size:12px;color:#71717a;text-align:center;margin-top:16px">Sent by Slotsmith on behalf of the business you booked with.</p>
</div></body></html>`;
}

export interface BookingEmailData {
  to: string;
  customerName: string;
  orgName: string;
  serviceName: string;
  staffName: string;
  /** Pre-formatted in the customer's zone, e.g. "Tue, Mar 10, 2026 at 14:30 (GMT-3)". */
  when: string;
  manageUrl: string;
}

export function bookingConfirmedEmail(d: BookingEmailData): EmailMessage {
  const lines = [
    `Hi ${d.customerName},`,
    `Your ${d.serviceName} with ${d.staffName} at ${d.orgName} is confirmed for ${d.when}.`,
  ];
  return {
    to: d.to,
    subject: `Confirmed: ${d.serviceName} on ${d.when}`,
    text: `${lines.join("\n\n")}\n\nManage your booking: ${d.manageUrl}`,
    html: layout(
      "Your booking is confirmed",
      lines.map((l) => `<p style="line-height:1.6">${escape(l)}</p>`).join(""),
      { label: "View or cancel booking", url: d.manageUrl },
    ),
  };
}

export function bookingReminderEmail(d: BookingEmailData): EmailMessage {
  const line = `Just a reminder: ${d.serviceName} with ${d.staffName} at ${d.orgName}, ${d.when}.`;
  return {
    to: d.to,
    subject: `Reminder: ${d.serviceName} ${d.when}`,
    text: `Hi ${d.customerName},\n\n${line}\n\nNeed to cancel? ${d.manageUrl}`,
    html: layout(
      "See you soon",
      `<p>Hi ${escape(d.customerName)},</p><p style="line-height:1.6">${escape(line)}</p>`,
      {
        label: "Manage booking",
        url: d.manageUrl,
      },
    ),
  };
}

export function bookingCancelledEmail(
  d: BookingEmailData,
  cancelledBy: "customer" | "business",
): EmailMessage {
  const line =
    cancelledBy === "customer"
      ? `Your ${d.serviceName} on ${d.when} has been cancelled as requested.`
      : `${d.orgName} had to cancel your ${d.serviceName} on ${d.when}. We're sorry for the inconvenience.`;
  return {
    to: d.to,
    subject: `Cancelled: ${d.serviceName} on ${d.when}`,
    text: `Hi ${d.customerName},\n\n${line}`,
    html: layout(
      "Booking cancelled",
      `<p>Hi ${escape(d.customerName)},</p><p style="line-height:1.6">${escape(line)}</p>`,
    ),
  };
}

export function invitationEmail(d: {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  url: string;
}): EmailMessage {
  const line = `${d.inviterName} invited you to join ${d.orgName} on Slotsmith as ${d.role}.`;
  return {
    to: d.to,
    subject: `You're invited to ${d.orgName} on Slotsmith`,
    text: `${line}\n\nAccept the invitation: ${d.url}\n\nThis link expires in 7 days.`,
    html: layout(
      "You've been invited",
      `<p style="line-height:1.6">${escape(line)}</p><p style="color:#71717a;font-size:14px">This link expires in 7 days.</p>`,
      {
        label: "Accept invitation",
        url: d.url,
      },
    ),
  };
}

export function magicLinkEmail(d: { to: string; url: string }): EmailMessage {
  return {
    to: d.to,
    subject: "Your Slotsmith sign-in link",
    text: `Sign in to Slotsmith: ${d.url}\n\nThe link expires in 5 minutes. If you didn't request it, ignore this email.`,
    html: layout(
      "Sign in to Slotsmith",
      `<p style="line-height:1.6">Click the button below to sign in. The link expires in 5 minutes.</p><p style="color:#71717a;font-size:14px">If you didn't request this, you can safely ignore it.</p>`,
      { label: "Sign in", url: d.url },
    ),
  };
}
