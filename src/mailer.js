import nodemailer from 'nodemailer';

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendVerifyCode(email, code) {
  if (!transporter) {
    console.log(`[mail:dev] → ${email} :: code = ${code}`);
    return { dev: true };
  }
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'FIRE ARENA — Verification Code',
    html: `<div style="font-family:sans-serif;background:#0a0a0f;color:#eee;padding:24px;border-radius:12px">
      <h2 style="color:#ff4d00;margin:0 0 8px">FIRE ARENA</h2>
      <p>Your verification code is:</p>
      <h1 style="letter-spacing:8px;color:#fff">${code}</h1>
      <p style="color:#888;font-size:12px">If you didn't request this, ignore it.</p>
    </div>`,
  });
  return { dev: false };
}
