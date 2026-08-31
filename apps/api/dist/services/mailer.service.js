import nodemailer from 'nodemailer';
import { adapters } from '../adapters/container.js';
function getSmtpConfig() {
    const host = process.env.SMTP_HOST || '';
    const port = parseInt(process.env.SMTP_PORT || '0', 10);
    const user = process.env.SMTP_USER || '';
    const appPassword = process.env.SMTP_APP_PASSWORD || '';
    if (!host || !port || !user || !appPassword) {
        adapters.logger.warn('[Mailer] SMTP configuration incomplete - email alerts disabled');
        return null;
    }
    return { host, port, user, appPassword };
}
/**
 * Send backup failure alert email.
 * Single-purpose function for internal ops alerts only.
 * Plain text format - no HTML templating.
 */
export async function sendBackupFailureAlert(error, context) {
    const config = getSmtpConfig();
    if (!config) {
        adapters.logger.error('(Mailer) No SMTP config - cannot send alert');
        return;
    }
    const recipient = process.env.BACKUP_ALERT_EMAIL || '';
    if (!recipient) {
        adapters.logger.warn('(Mailer) BACKUP_ALERT_EMAIL not set - cannot send alert');
        return;
    }
    try {
        const transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: false, // TLS STARTTLS
            auth: {
                user: config.user,
                pass: config.appPassword,
            },
        });
        const timestamp = new Date();
        const timestampWIB = timestamp.toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        const subject = `[BACKUP ALERT] Backup job failed`;
        const body = `BACKUP FAILURE ALERT

Backup job failed at ${timestampWIB} (WIB)

${context ? `Context: ${context}\n` : ''}Error Details:
${error.message}

---
This is an automated alert from the Garuda backup system.
Please investigate the backup failure immediately.
`;
        await transporter.sendMail({
            from: `"Garuda Backup" <${config.user}>`,
            to: recipient,
            subject,
            text: body,
        });
        adapters.logger.info('(Mailer) Backup failure alert sent successfully', { recipient });
    }
    catch (msg) {
        adapters.logger.error('(Mailer) Failed to send backup failure alert', msg);
        throw msg; // Re-throw so caller knows the alert failed
    }
}
//# sourceMappingURL=mailer.service.js.map