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
      subject: "Verify your e-commerce account",
      text: `Hello ${name}, your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Hello ${escapeHtml(name)},</p><p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`
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
