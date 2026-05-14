import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';
import * as path from 'path';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import {
  SENDGRID_API_KEY,
  SENDGRID_SENDER_EMAIL,
  SENDGRID_SENDER_NAME,
  SUPPORT_EMAIL,
  SUPPORT_MOBILE_NUMBER,
} from '../../shared/constants';

/**
 * Templates are loaded from `<cwd>/templates/<name>.hbs`. The folder ships
 * empty — drop your own .hbs files in (e.g. otp-email-verification.hbs) before
 * calling the matching `send*` method.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private supportEmail: string;
  private supportMobileNumber: string;
  private senderName: string;
  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>(SENDGRID_API_KEY);
    if (apiKey) {
      sgMail.setApiKey(apiKey);
    }
    this.supportEmail = this.configService.get<string>(SUPPORT_EMAIL)!;
    this.supportMobileNumber =
      this.configService.get<string>(SUPPORT_MOBILE_NUMBER)!;
    this.senderName =
      this.configService.get<string>(SENDGRID_SENDER_NAME) || 'Trace';
  }

  private getCurrentYear() {
    return new Date().getFullYear()?.toString();
  }

  private async compileTemplate<T = unknown>(templateName: string, data: T) {
    const enriched = {
      ...data,
      supportEmail: this.supportEmail,
      supportMobileNumber: this.supportMobileNumber,
      currentYear: this.getCurrentYear(),
    };
    const filePath = path.join(
      process.cwd(),
      'templates',
      `${templateName}.hbs`,
    );
    const source = await fs.promises.readFile(filePath, 'utf8');
    const template = handlebars.compile(source);
    return template(enriched);
  }

  async sendMail<T>(
    to: string,
    subject: string,
    templateFileName: string,
    context: T,
  ) {
    const sender = this.configService.get<string>(SENDGRID_SENDER_EMAIL);

    if (!sender) {
      throw new Error(
        `${SENDGRID_SENDER_EMAIL} is not defined in environment variables`,
      );
    }
    const htmlContent = await this.compileTemplate(templateFileName, {
      ...context,
      email: to,
    });

    const msg: sgMail.MailDataRequired = {
      to,
      from: { email: sender, name: this.senderName },
      subject,
      html: htmlContent,
    };
    return sgMail.send(msg);
  }

  async sendEmailVerificationOTPEmail(to: string, otp: string, name: string) {
    if (!to) return;
    return this.sendMail(to, 'Verify your email', 'otp-email-verification', {
      name,
      otp,
    });
  }

  async sendPasswordResetOTPEmail(to: string, otp: string, name: string) {
    if (!to) return;
    return this.sendMail(to, 'Reset your password', 'otp-password-reset', {
      name,
      otp,
    });
  }

  async sendAccountCreationOTPEmail(to: string, otp: string, name: string) {
    if (!to) return;
    return this.sendMail(
      to,
      'Finish creating your account',
      'otp-account-creation',
      { name, otp },
    );
  }

  async sendPasswordChangedEmail(to: string, name: string) {
    if (!to) return;
    return this.sendMail(to, 'Your password was changed', 'password-changed', {
      name,
    });
  }

  async sendWelcomeEmail(
    to: string,
    data: { firstName: string; ctaUrl?: string },
  ) {
    if (!to) return;
    return this.sendMail(to, 'Welcome!', 'welcome', data);
  }
}
