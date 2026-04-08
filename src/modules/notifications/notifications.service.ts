import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@modules/users/entities/user.entity';
import { SystemRole } from '@common/enums';

/**
 * Сервіс сповіщень (FR-11 — інтеграція Telegram).
 *
 * Надсилає push-сповіщення координаторам через Telegram-бот
 * при появі критичних заявок та зміні статусів задач.
 *
 * Якщо TELEGRAM_BOT_TOKEN не налаштований — логує сповіщення
 * у консоль без помилок (graceful degradation).
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private botToken: string | null;
  private readonly TELEGRAM_API = 'https://api.telegram.org/bot';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  onModuleInit() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || null;
    if (!this.botToken) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN не налаштовано. Telegram-сповіщення вимкнено.',
      );
    } else {
      this.logger.log('✅ Telegram-бот ініціалізовано');
    }
  }

  // ─── Публічні методи ──────────────────────────────────────────────────────

  /** Сповістити координаторів про нову критичну заявку */
  async notifyNewCriticalRequest(
    requestTitle: string,
    requestId: string,
    urgency: string,
  ): Promise<void> {
    if (urgency !== 'critical' && urgency !== 'high') return;

    const emoji = urgency === 'critical' ? '🚨' : '⚠️';
    const message =
      `${emoji} <b>Нова ${urgency === 'critical' ? 'КРИТИЧНА' : 'термінова'} заявка</b>\n\n` +
      `📋 <b>${this.escapeHtml(requestTitle)}</b>\n\n` +
      `Для перегляду деталей відкрийте систему та знайдіть заявку.\n` +
      `ID: <code>${requestId}</code>`;

    await this.broadcastToRole(SystemRole.COORDINATOR, message);
    await this.broadcastToRole(SystemRole.ADMIN, message);
  }

  /** Сповістити автора заявки про знайдений екіпаж */
  async notifyRequesterTeamFound(
    requesterId: string,
    taskTitle: string,
    volunteerName: string,
  ): Promise<void> {
    const message =
      `✅ <b>Волонтер знайдено!</b>\n\n` +
      `До задачі "<b>${this.escapeHtml(taskTitle)}</b>" приєднався волонтер <b>${this.escapeHtml(volunteerName)}</b>.\n\n` +
      `Ви отримаєте деталі у чаті системи.`;

    await this.sendToUser(requesterId, message);
  }

  /** Сповістити волонтера про призначення на задачу */
  async notifyVolunteerAssigned(
    volunteerId: string,
    taskTitle: string,
    requestTitle: string,
  ): Promise<void> {
    const message =
      `📌 <b>Нове призначення</b>\n\n` +
      `Ви додані до задачі: "<b>${this.escapeHtml(taskTitle)}</b>"\n` +
      `Заявка: <b>${this.escapeHtml(requestTitle)}</b>\n\n` +
      `Відкрийте систему для отримання деталей та доступу до чату.`;

    await this.sendToUser(volunteerId, message);
  }

  /** Сповістити координатора про делегування задачі */
  async notifyDelegation(
    orgId: string,
    taskTitle: string,
    fromOrgName: string,
  ): Promise<void> {
    const message =
      `🔄 <b>Нова делегована задача</b>\n\n` +
      `Організація <b>${this.escapeHtml(fromOrgName)}</b> передала вашій організації задачу:\n` +
      `"<b>${this.escapeHtml(taskTitle)}</b>"\n\n` +
      `Перейдіть до системи для підтвердження.`;

    await this.broadcastToOrgCoordinators(orgId, message);
  }

  // ─── Приватні методи ──────────────────────────────────────────────────────

  private async broadcastToRole(role: SystemRole, message: string): Promise<void> {
    const users = await this.userRepo.find({
      where: { systemRole: role, isBlocked: false },
      select: ['id', 'telegramChatId'],
    });

    const promises = users
      .filter((u) => u.telegramChatId)
      .map((u) => this.sendTelegramMessage(u.telegramChatId, message));

    await Promise.allSettled(promises);
  }

  private async broadcastToOrgCoordinators(
    orgId: string,
    message: string,
  ): Promise<void> {
    // Знаходимо координаторів організації
    const result = await this.userRepo
      .createQueryBuilder('user')
      .innerJoin('user.organizationMemberships', 'member')
      .where('member.organization_id = :orgId', { orgId })
      .andWhere("member.org_role IN ('leader', 'coordinator')")
      .andWhere('user.telegram_chat_id IS NOT NULL')
      .select(['user.id', 'user.telegramChatId'])
      .getMany();

    await Promise.allSettled(
      result.map((u) => this.sendTelegramMessage(u.telegramChatId, message)),
    );
  }

  private async sendToUser(userId: string, message: string): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['telegramChatId'],
    });

    if (user?.telegramChatId) {
      await this.sendTelegramMessage(user.telegramChatId, message);
    }
  }

  private async sendTelegramMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    if (!this.botToken) {
      // Graceful degradation: логуємо замість помилки
      this.logger.debug(`[Telegram stub] → ${chatId}: ${text.substring(0, 80)}...`);
      return;
    }

    try {
      const url = `${this.TELEGRAM_API}${this.botToken}/sendMessage`;
      const body = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      // Використовуємо вбудований fetch (Node.js 18+)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000), // 5 секунд таймаут
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(`Telegram API помилка для ${chatId}: ${error}`);
      }
    } catch (err) {
      // Не кидаємо помилку — сповіщення є другорядною функцією
      this.logger.warn(`Не вдалося надіслати Telegram-сповіщення: ${err.message}`);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
