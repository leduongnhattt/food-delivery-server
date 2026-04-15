import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import * as amqp from 'amqplib';
import { MailService } from '@infra/mail/mail.service';
import {
  buildSupportReplyEmailHtml,
  buildSupportReplyEmailText,
} from '@infra/templates/support-reply.templates';
import { buildRabbitMqConnectionUrl } from './rabbitmq-url';
import {
  SUPPORT_EXCHANGE,
  SUPPORT_QUEUE_NOTIFICATIONS,
  SUPPORT_ROUTING_ADMIN_REPLIED,
} from './support-events.constants';
import type { SupportAdminRepliedPayload } from './support-admin-replied.payload';

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private ready = false;

  constructor(private readonly mail: MailService) {}

  async onModuleInit(): Promise<void> {
    const url = buildRabbitMqConnectionUrl();
    if (!url) {
      this.logger.warn(
        'RabbitMQ URL not configured; support email queue disabled',
      );
      return;
    }
    try {
      const conn = await amqp.connect(url);
      this.connection = conn;
      const ch = await conn.createChannel();
      this.channel = ch;
      await ch.assertExchange(SUPPORT_EXCHANGE, 'topic', { durable: true });
      await ch.assertQueue(SUPPORT_QUEUE_NOTIFICATIONS, { durable: true });
      await ch.bindQueue(
        SUPPORT_QUEUE_NOTIFICATIONS,
        SUPPORT_EXCHANGE,
        SUPPORT_ROUTING_ADMIN_REPLIED,
      );

      await ch.consume(
        SUPPORT_QUEUE_NOTIFICATIONS,
        (msg) => {
          void this.handleMessage(ch, msg);
        },
        { noAck: false },
      );

      this.ready = true;
      this.logger.log('RabbitMQ connected; support notification consumer ready');
    } catch (e) {
      this.logger.error('RabbitMQ init failed', e);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      /* ignore */
    }
  }

  publishAdminReplied(payload: SupportAdminRepliedPayload): void {
    if (!this.channel || !this.ready) {
      this.logger.warn('RabbitMQ not ready; skipping publish');
      return;
    }
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    this.channel.publish(SUPPORT_EXCHANGE, SUPPORT_ROUTING_ADMIN_REPLIED, buf, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  private async handleMessage(
    ch: Channel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (!msg) return;
    try {
      const raw = msg.content.toString('utf8');
      const data = JSON.parse(raw) as SupportAdminRepliedPayload;
      const appName = process.env.APP_NAME || 'HanalaFood';
      const html = buildSupportReplyEmailHtml({
        appName,
        username: data.requesterUsername || 'there',
        ticketId: data.ticketId,
        ticketSubject: data.ticketSubject,
        ticketCategory: data.ticketCategory,
        ticketStatus: data.ticketStatus,
        replyBody: data.replyBody,
      });
      const text = buildSupportReplyEmailText({
        appName,
        username: data.requesterUsername || 'there',
        ticketId: data.ticketId,
        ticketSubject: data.ticketSubject,
        ticketCategory: data.ticketCategory,
        ticketStatus: data.ticketStatus,
        replyBody: data.replyBody,
      });
      const ok = await this.mail.sendMail({
        to: data.requesterEmail,
        subject: `[${appName}] Support reply: ${data.ticketSubject}`,
        html,
        text,
      });
      if (ok) {
        ch.ack(msg);
      } else {
        ch.nack(msg, false, true);
      }
    } catch (e) {
      this.logger.error('support notification consume failed', e);
      ch.nack(msg, false, true);
    }
  }
}
