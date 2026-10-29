const env = require("../config/env");
const { ApiError } = require("../lib/http");

let transporter;

async function sendVerificationCode(email, name, code) {
  if (!env.SMTP_CONFIGURED) {
    throw new ApiError(503, "EMAIL_UNAVAILABLE", "Email verification is not configured on this server");
  }

  if (!transporter) {
    const nodemailer = await import("nodemailer");
    transporter = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
    });
  }

  try {
 await transporter.sendMail({
    from: env.SMTP_FROM,
    to: email,
    subject: "Verify Your Account | Avenza",
    text: `Hello ${name}, your Avenza verification code is ${code}. It expires in 10 minutes. If you did not create an account, you can safely ignore this email.`,
    html: `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Verify Your Avenza Account</title>
      </head>

      <body style="margin:0;padding:0;background-color:#f3f5fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="background-color:#f3f5fb;padding:36px 12px;">
          <tr>
            <td align="center">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="max-width:560px;background-color:#ffffff;border-radius:18px;overflow:hidden;">

                <!-- Brand Header -->
                <tr>
                  <td align="center"
                    style="background-color:#4f46e5;background-image:linear-gradient(135deg,#4f46e5,#7c3aed);padding:36px 24px;">
                    <div style="font-size:30px;font-weight:800;letter-spacing:1px;color:#ffffff;">
                      Avenza
                    </div>
                    <p style="margin:10px 0 0;font-size:13px;line-height:20px;color:#e0e7ff;">
                      YOUR SHOPPING JOURNEY STARTS HERE
                    </p>
                  </td>
                </tr>

                <!-- Email Content -->
                <tr>
                  <td style="padding:36px 30px 24px;">

                    <div style="text-align:center;font-size:38px;line-height:1;">
                      &#128075;
                    </div>

                    <h1 style="margin:20px 0 12px;text-align:center;font-size:25px;line-height:34px;color:#111827;">
                      Verify Your Email
                    </h1>

                    <p style="margin:0 0 20px;font-size:15px;line-height:25px;color:#4b5563;">
                      Hello <strong style="color:#111827;">${escapeHtml(name)}</strong>,
                    </p>

                    <p style="margin:0 0 26px;font-size:15px;line-height:25px;color:#4b5563;">
                      Welcome to Avenza! We're excited to have you here.
                      Please use the verification code below to verify your email
                      address and complete your account registration.
                    </p>

                    <!-- Verification Code -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="background-color:#f5f3ff;border:1px solid #ddd6fe;border-radius:14px;">
                      <tr>
                        <td align="center" style="padding:24px 16px;">
                          <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:2px;color:#6d28d9;">
                            YOUR VERIFICATION CODE
                          </p>

                          <div style="font-size:34px;line-height:44px;font-weight:800;letter-spacing:8px;color:#4338ca;">
                            ${escapeHtml(String(code))}
                          </div>

                          <p style="margin:14px 0 0;font-size:13px;line-height:20px;color:#6b7280;">
                            Enter this code on the verification page.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Expiry Notice -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="margin-top:22px;">
                      <tr>
                        <td width="30" valign="top" style="font-size:19px;padding-top:1px;">
                          &#9200;
                        </td>
                        <td style="font-size:13px;line-height:22px;color:#4b5563;">
                          <strong style="color:#111827;">Code expires in 10 minutes.</strong>
                          For your security, please complete verification before it expires.
                        </td>
                      </tr>
                    </table>

                    <p style="margin:24px 0 0;font-size:13px;line-height:22px;color:#6b7280;">
                      If you didn't create an Avenza account, you can safely ignore this email.
                      Never share your verification code with anyone.
                    </p>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td align="center"
                    style="background-color:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 24px;">
                    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151;">
                      Thank you for choosing Avenza!
                    </p>

                    <p style="margin:0;font-size:11px;line-height:19px;color:#9ca3af;">
                      This is an automated security email. Please do not reply.
                    </p>

                    <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;">
                      &copy; ${new Date().getFullYear()} Avenza. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>
      </body>
    </html>
  `
  });
  } catch (error) {
    console.error("Verification email delivery failed", {
      code: error.code,
      command: error.command,
      responseCode: error.responseCode
    });
    throw new ApiError(503, "EMAIL_DELIVERY_FAILED", "The verification email could not be sent; try again later");
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

module.exports = { sendVerificationCode };
