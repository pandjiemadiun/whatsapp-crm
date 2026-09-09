import nodemailer from 'nodemailer';
import { config } from 'dotenv';
config({ path: '../../.env' });

async function main() {
  const host = process.env.SMTP_HOST || '';
  const port = parseInt(process.env.SMTP_PORT || '0', 10);
  const user = process.env.SMTP_USER || '';
  const appPassword = process.env.SMTP_APP_PASSWORD || '';

  console.log('SMTP Config:', { host, port, user, hasPassword: !!appPassword });

  if (!host || !port || !user || !appPassword) {
    console.error('SMTP configuration incomplete');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false, // TLS STARTTLS
    auth: { user, pass: appPassword },
  });

  const recipient = 'dwiputroagung2773@gmail.com';
  const subject = '[SMTP TEST] Test email from Garuda';
  const body = `This is a test email sent at ${new Date().toISOString()}.

If you receive this, SMTP is working correctly.`;

  console.log(`Sending test email to ${recipient}...`);
  const result = await transporter.sendMail({
    from: `"Garuda Test" <${user}>`,
    to: recipient,
    subject,
    text: body,
  });

  console.log('Email sent successfully:', result.messageId);
  await transporter.close();
}

main().catch((e) => {
  console.error('Failed to send email:', e);
  process.exit(1);
});
