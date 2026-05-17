import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

/**
 * EmailService — надсилання електронних листів.
 *
 * Graceful degradation: якщо SMTP_HOST не налаштований,
 * замість помилки просто логує лист у консоль.
 * Це дозволяє запускати систему в dev без SMTP-сервера.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn(
        'SMTP_HOST не налаштований. Email-сповіщення будуть логуватись у консоль.',
      );
      return;
    }

    this.fromAddress = this.config.get<string>('SMTP_FROM') ||
      `"Волонтерська допомога" <${this.config.get('SMTP_USER')}>`;

    this.transporter = nodemailer.createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT') || 587,
      secure: this.config.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });

    this.logger.log('✅ Email-сервіс ініціалізовано (SMTP)');
  }

  // ─── Підтвердження пошти ─────────────────────────────────────────────────

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;

    const subject = '✅ Підтвердіть вашу електронну пошту — Волонтерська допомога';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1a56db">🇺🇦 Волонтерська допомога</h2>
        <p>Вітаємо! Для завершення реєстрації підтвердіть вашу електронну пошту:</p>
        <a href="${verifyUrl}"
           style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">
          Підтвердити пошту
        </a>
        <p style="color:#666;font-size:13px">
          Якщо ви не реєструвались — проігноруйте цей лист.<br>
          Посилання дійсне 24 години.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">
          Якщо кнопка не працює, скопіюйте посилання:<br>
          <a href="${verifyUrl}" style="color:#1a56db">${verifyUrl}</a>
        </p>
      </div>
    `;

    await this.sendMail({ to: email, subject, html });
  }

  // ─── Скидання пароля (6-значний код) ─────────────────────────────────────

  async sendPasswordResetCode(email: string, code: string): Promise<void> {
    const subject = '🔑 Код для скидання пароля — Волонтерська допомога';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1a56db">🇺🇦 Волонтерська допомога</h2>
        <p>Ви запросили скидання пароля. Ваш код підтвердження:</p>
        <div style="text-align:center;font-size:36px;font-weight:800;letter-spacing:8px;
                    background:#f3f4f6;border-radius:12px;padding:20px;margin:20px 0;
                    color:#1a56db">
          ${code}
        </div>
        <p style="color:#666;font-size:13px">
          Введіть цей код у додатку, щоб відновити пароль.<br>
          Код дійсний 10 хвилин.<br><br>
          Якщо ви не надсилали цей запит — проігноруйте лист.
        </p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#999;font-size:12px">
          Якщо ви не можете ввести код, просто проігноруйте цей лист.<br>
          Нікому не повідомляйте цей код.
        </p>
      </div>
    `;

    await this.sendMail({ to: email, subject, html });
  }

  // ← Колишній sendPasswordResetEmail залишається для зворотної сумісності
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:3000';
    const resetUrl = `${appUrl}/api/auth/reset-password?token=${token}`;

    const subject = '🔑 Скидання пароля (посилання) — Волонтерська допомога';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="color:#1a56db">🇺🇦 Волонтерська допомога</h2>
        <p>Ви запросили скидання пароля. Натисніть кнопку нижче:</p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#e53e3e;color:#fff;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">
          Скинути пароль
        </a>
        <p style="color:#666;font-size:13px">
          Якщо ви не надсилали цей запит — проігноруйте лист.<br>
          Посилання дійсне 1 годину.
        </p>
      </div>
    `;

    await this.sendMail({ to: email, subject, html });
  }

  // ─── Приватний метод ─────────────────────────────────────────────────────

  private async sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
    if (!this.transporter) {
      // Dev-stub: виводимо у консоль замість реального надсилання
      this.logger.debug(
        `[EMAIL STUB] To: ${opts.to} | Subject: ${opts.subject}\n` +
        opts.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      this.logger.debug(`Email надіслано → ${opts.to}`);
    } catch (err) {
      this.logger.error(`Помилка надсилання email на ${opts.to}: ${(err as Error).message}`);
      // Не кидаємо помилку вгору — email є другорядною функцією
    }
  }
}
