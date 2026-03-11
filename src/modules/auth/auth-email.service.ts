import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

const APP_NAME = process.env.APP_NAME || 'HanalaFood';
const SUPPORT_EMAIL = process.env.SMTP_USER || 'support@example.com';

@Injectable()
export class AuthEmailService {
  private readonly transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendPasswordResetCode(
    to: string,
    resetCode: string,
    username: string,
  ): Promise<boolean> {
    const html = this.buildResetCodeHtml(resetCode, username);
    const text = `Your password reset code is: ${resetCode}. This code will expire in 60 seconds.`;
    try {
      await this.transporter.sendMail({
        from: `"${APP_NAME}" <${process.env.SMTP_USER}>`,
        to,
        subject: `Password Reset Code - ${APP_NAME}`,
        html,
        text,
      });
      return true;
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return false;
    }
  }

  async sendPasswordResetSuccess(to: string, username: string): Promise<boolean> {
    const html = this.buildResetSuccessHtml(username);
    try {
      await this.transporter.sendMail({
        from: `"${APP_NAME}" <${process.env.SMTP_USER}>`,
        to,
        subject: `Password Reset Successful - ${APP_NAME}`,
        html,
      });
      return true;
    } catch (error) {
      console.error('Failed to send password reset success email:', error);
      return false;
    }
  }

  private buildResetCodeHtml(resetCode: string, username: string): string {
    return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Reset your password</title></head>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Hi ${username},</h2>
      <p>We received a request to reset your password. Use the code below:</p>
      <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${resetCode}</p>
      <p>This code expires in 60 seconds.</p>
      <p>If you didn't request this, please ignore this email.</p>
      <hr>
      <p style="color: #666;">© ${APP_NAME}. Support: ${SUPPORT_EMAIL}</p>
    </body></html>`;
  }

  private buildResetSuccessHtml(username: string): string {
    return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Password updated</title></head>
    <body style="font-family: Arial, sans-serif; padding: 20px;">
      <h2>Hi ${username},</h2>
      <p>Your password has been updated successfully. You can now sign in with your new password.</p>
      <hr>
      <p style="color: #666;">© ${APP_NAME}. Support: ${SUPPORT_EMAIL}</p>
    </body></html>`;
  }
}
