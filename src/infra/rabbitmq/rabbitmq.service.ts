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
import {
  ORDERS_EXCHANGE,
  ORDERS_QUEUE_NOTIFICATIONS,
  ORDERS_ROUTING_ENTERPRISE_ORDER_CREATED,
} from './orders-events.constants';
import type { EnterpriseOrderCreatedPayload } from './enterprise-order-created.payload';

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private ready = false;
  private ordersCreatedHandler:
    | ((payload: EnterpriseOrderCreatedPayload) => Promise<void> | void)
    | null = null;

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
      // Support email notification consumer
      await ch.assertExchange(SUPPORT_EXCHANGE, 'topic', { durable: true });
      await ch.assertQueue(SUPPORT_QUEUE_NOTIFICATIONS, { durable: true });
      await ch.bindQueue(
        SUPPORT_QUEUE_NOTIFICATIONS,
        SUPPORT_EXCHANGE,
        SUPPORT_ROUTING_ADMIN_REPLIED,
      );
      await ch.consume(
        SUPPORT_QUEUE_NOTIFICATIONS,
        (msg) => void this.handleSupportMessage(ch, msg),
        { noAck: false },
      );

      // Orders notification consumer (enterprise new order)
      await this.ensureOrdersConsumerWired(ch);

      this.ready = true;
      this.logger.log('RabbitMQ connected; consumers ready');
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

  publishEnterpriseOrderCreated(payload: EnterpriseOrderCreatedPayload): void {
    if (!this.channel || !this.ready) {
      this.logger.warn('RabbitMQ not ready; skipping publish');
      return;
    }
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    this.channel.publish(
      ORDERS_EXCHANGE,
      ORDERS_ROUTING_ENTERPRISE_ORDER_CREATED,
      buf,
      {
        persistent: true,
        contentType: 'application/json',
      },
    );
  }

  onEnterpriseOrderCreated(
    handler: (payload: EnterpriseOrderCreatedPayload) => Promise<void> | void,
  ): void {
    this.ordersCreatedHandler = handler;
    if (this.channel && this.ready) {
      void this.ensureOrdersConsumerWired(this.channel);
    }
  }

  private async handleSupportMessage(
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

  private async ensureOrdersConsumerWired(ch: Channel): Promise<void> {
    await ch.assertExchange(ORDERS_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(ORDERS_QUEUE_NOTIFICATIONS, { durable: true });
    await ch.bindQueue(
      ORDERS_QUEUE_NOTIFICATIONS,
      ORDERS_EXCHANGE,
      ORDERS_ROUTING_ENTERPRISE_ORDER_CREATED,
    );
    // Only start consuming when a handler is registered.
    if (!this.ordersCreatedHandler) return;
    await ch.consume(
      ORDERS_QUEUE_NOTIFICATIONS,
      (msg) => void this.handleOrdersCreated(ch, msg),
      { noAck: false },
    );
  }

  private async handleOrdersCreated(
    ch: Channel,
    msg: ConsumeMessage | null,
  ): Promise<void> {
    if (!msg) return;
    try {
      const raw = msg.content.toString('utf8');
      const payload = JSON.parse(raw) as EnterpriseOrderCreatedPayload;
      if (!this.ordersCreatedHandler) {
        // consumer exists but handler missing (should be rare); retry later
        ch.nack(msg, false, true);
        return;
      }
      await this.ordersCreatedHandler(payload);
      ch.ack(msg);
    } catch (e) {
      this.logger.error('orders.enterprise.created consume failed', e);
      ch.nack(msg, false, true);
    }
  }
}
