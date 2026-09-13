import { config } from "../config.ts";
import { getSql } from "../db.ts";
import { id } from "../ids.ts";

export interface MailInput {
  stream: string;
  toEmail: string;
  toUserId?: string | null;
  subject: string;
  html: string;
  text: string;
  templateKey: string;
  payload?: Record<string, unknown>;
}

function shell(title: string, body: string, ctaLabel?: string, ctaHref?: string): string {
  const button = ctaLabel && ctaHref
    ? `<p style="margin:28px 0 8px"><a href="${ctaHref}" style="display:inline-block;background:#1c1914;color:#f4efe4;text-decoration:none;padding:12px 18px;font-family:Georgia,serif;font-size:15px">${ctaLabel}</a></p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;background:#ebe4d4;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto;background:#f7f2e8;border:1px solid #d4cbb8;padding:32px">
    <div style="font-family:Georgia,serif;letter-spacing:.18em;font-size:12px;color:#8c3d1c;text-transform:uppercase">Myplace</div>
    <h1 style="font-family:Georgia,serif;font-size:26px;line-height:1.2;color:#1c1914;font-weight:500;margin:12px 0 20px">${title}</h1>
    <div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#2b261f">${body}</div>
    ${button}
    <p style="margin-top:36px;font-family:system-ui,sans-serif;font-size:12px;color:#5c564c">This is a transactional notice from Myplace about a property record.</p>
  </div>
</body></html>`;
}

export async function sendMail(input: MailInput): Promise<string> {
  const sql = getSql();
  const emailId = id("eml");
  await sql`
    INSERT INTO emails (
      email_id, stream, to_email, to_user_id, subject, html, text_body, template_key, payload_json
    ) VALUES (
      ${emailId}, ${input.stream}, ${input.toEmail}, ${input.toUserId ?? null},
      ${input.subject}, ${input.html}, ${input.text}, ${input.templateKey},
      ${sql.json((input.payload ?? {}) as never)}
    )
  `;
  if (config.isProduction) {
    await deliverWithPostmark(input, emailId);
  }
  return emailId;
}

async function deliverWithPostmark(input: MailInput, emailId: string): Promise<void> {
  const token = config.postmarkServerToken;
  const from = config.mailFrom;
  if (!token || !from) {
    console.warn(`email ${emailId} (${input.templateKey}) stored but not delivered: set POSTMARK_SERVER_TOKEN and MAIL_FROM`);
    return;
  }
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-postmark-server-token": token,
    },
    body: JSON.stringify({
      From: from,
      To: input.toEmail,
      Subject: input.subject,
      HtmlBody: input.html,
      TextBody: input.text,
      MessageStream: "outbound",
      Tag: input.templateKey,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`Email delivery failed (${res.status}) ${detail}`.trim()), { status: 502 });
  }
}

export function authCodeEmail(appOrigin: string, email: string, code: string) {
  const href = `${appOrigin}/signin?email=${encodeURIComponent(email)}`;
  return {
    subject: "Your Myplace sign-in code",
    html: shell(
      "Your sign-in code",
      `<p>Use this code to finish signing in to Myplace.</p>
       <p style="font-size:32px;letter-spacing:.2em;margin:20px 0">${code}</p>
       <p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>`,
      "Return to sign in",
      href,
    ),
    text: `Your Myplace sign-in code is ${code}. It expires in 15 minutes.`,
  };
}

export function claimReceivedEmail(appOrigin: string, address: string, claimId: string, propertyId: string) {
  const href = `${appOrigin}/property/${propertyId}/claim/${claimId}`;
  return {
    subject: `We received your claim for ${address}`,
    html: shell(
      "Claim received",
      `<p>We received your request to claim <strong>${address}</strong>.</p>
       <p>A reviewer will confirm that you are the current owner. This usually takes one to two business days. You will get another email when the review is complete.</p>`,
      "View claim status",
      href,
    ),
    text: `We received your claim for ${address}. Track it at ${href}`,
  };
}

export function claimReviewedEmail(
  appOrigin: string,
  address: string,
  propertyId: string,
  approved: boolean,
  note?: string | null,
) {
  if (approved) {
    const href = `${appOrigin}/property/${propertyId}/manage`;
    return {
      subject: `You are now the owner maintainer for ${address}`,
      html: shell(
        "Ownership verified",
        `<p>Your claim for <strong>${address}</strong> has been verified. You can now maintain the owner record, upload documents, and prepare a future handoff.</p>
         <p>Official government facts stay on the public record. You cannot overwrite them, but you can add what only you know.</p>`,
        "Open owner record",
        href,
      ),
      text: `Your claim for ${address} was verified. Open ${href}`,
    };
  }
  const href = `${appOrigin}/property/${propertyId}`;
  const extra = note ? `<p>Reviewer note: ${note}</p>` : "";
  return {
    subject: `Update on your claim for ${address}`,
    html: shell(
      "Claim not verified",
      `<p>We could not verify current ownership for <strong>${address}</strong>.</p>${extra}
       <p>You can submit a new claim with different documents if you believe this is your property.</p>`,
      "Return to property",
      href,
    ),
    text: `Your claim for ${address} was not verified. ${note ?? ""}`,
  };
}

export function handoffEmail(appOrigin: string, address: string, propertyId: string, fromName: string) {
  const href = `${appOrigin}/property/${propertyId}/claim`;
  return {
    subject: `${fromName} invited you to claim ${address}`,
    html: shell(
      "You were invited to claim a property",
      `<p>${fromName} is preparing a record handoff for <strong>${address}</strong>.</p>
       <p>Create a Myplace account and complete ownership verification to become the new maintainer. Private seller documents will not transfer.</p>`,
      "Claim this property",
      href,
    ),
    text: `${fromName} invited you to claim ${address}. Start at ${href}`,
  };
}

export function coOwnerInviteEmail(appOrigin: string, address: string, propertyId: string, fromName: string) {
  const href = `${appOrigin}/property/${propertyId}`;
  return {
    subject: `${fromName} invited you to co-maintain ${address}`,
    html: shell(
      "You were invited to co-maintain a property record",
      `<p>${fromName} added you as a co-owner of the record for <strong>${address}</strong>.</p>
       <p>Sign in with this email address and open the property to accept. You will be able to maintain the owner record, upload documents, and see the full history alongside them.</p>`,
      "Open the property",
      href,
    ),
    text: `${fromName} invited you to co-maintain ${address}. Sign in and open ${href} to accept.`,
  };
}

export function ownershipRevokedEmail(appOrigin: string, address: string, propertyId: string) {
  const href = `${appOrigin}/property/${propertyId}`;
  return {
    subject: `Your maintainer access to ${address} has ended`,
    html: shell(
      "Maintainer access ended",
      `<p>You are no longer a maintainer of the record for <strong>${address}</strong>.</p>
       <p>The public record stays available. Documents you marked as property-transferable remain with the property; personal documents stay private to you.</p>`,
      "View the property",
      href,
    ),
    text: `Your maintainer access to ${address} has ended. View ${href}`,
  };
}

export function adminClaimEmail(appOrigin: string, address: string, claimId: string) {
  const href = `${appOrigin}/admin/claims/${claimId}`;
  return {
    subject: `Review needed: ownership claim for ${address}`,
    html: shell(
      "Ownership claim to review",
      `<p>A new ownership claim is waiting for review: <strong>${address}</strong>.</p>`,
      "Review claim",
      href,
    ),
    text: `Review ownership claim for ${address}: ${href}`,
  };
}
