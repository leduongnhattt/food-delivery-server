import { Injectable } from '@nestjs/common';
import { MailService } from '@infra/mail/mail.service';
import {
  generatePasswordResetEmail,
  generatePasswordResetSuccessEmail,
} from '@infra/templates/auth-email.templates';

@Injectable()
export class AuthEmailService {
  constructor(private readonly mail: MailService) {}

  async sendPasswordResetCode(
    to: string,
    resetCode: string,
    username: string,
  ): Promise<boolean> {
    const html = generatePasswordResetEmail(resetCode, username);
    const text = `Your password reset code is: ${resetCode}. This code will expire in 60 seconds.`;
    return this.mail.sendMail({
      to,
      subject: `Password Reset Code - ${process.env.APP_NAME || 'HanalaFood'}`,
      html,
      text,
    });
  }

  async sendPasswordResetSuccess(to: string, username: string): Promise<boolean> {
    const html = generatePasswordResetSuccessEmail(username);
    return this.mail.sendMail({
      to,
      subject: `Password Reset Successful - ${process.env.APP_NAME || 'HanalaFood'}`,
      html,
    });
  }
}
