import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export type SendMailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Single SMTP transporter for all outbound mail (support, auth, etc.).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor() {
    const smtpUser = (process.env.SMTP_USER || '').trim();
    // Gmail App Passwords are often displayed with spaces; strip them defensively.
    const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
    if (!smtpUser || !smtpPass) {
      this.logger.warn(
        'SMTP is not fully configured (missing SMTP_USER/SMTP_PASS); outbound email will fail',
      );
    }
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser || undefined,
        pass: smtpPass || undefined,
      },
    });
    const app = process.env.APP_NAME || 'HanalaFood';
    const user = smtpUser || 'noreply@example.com';
    this.fromAddress = `"${app}" <${user}>`;
  }

  async sendMail(params: SendMailParams): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      return true;
    } catch (err) {
      this.logger.error('sendMail failed', err);
      return false;
    }
  }
}
