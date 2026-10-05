import FormData from "form-data";
import Mailgun from "mailgun.js";
import dotenv from "dotenv";

dotenv.config();

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({
  username: "api",
  key: process.env.MG_API_KEY,
});

export async function sendPasswordReset(toEmail, resetToken) {
  const resetUrl = `https://ebubbl.com/reset-password?token=${resetToken}`;

  try {
    const data = await mg.messages.create(process.env.MG_DOMAIN, {
      from: `ebubbl <noreply@${process.env.MG_DOMAIN}>`,
      to: [toEmail],
      subject: "Reset your ebubbl password",
      text: `Click this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
      html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p>`,
    });
    console.log("Email sent:", data.id);
    return data;
  } catch (error) {
    console.error("Email failed:", error);
    throw error;
  }
}
