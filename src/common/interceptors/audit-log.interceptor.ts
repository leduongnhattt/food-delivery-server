import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { JwtPayload } from '@modules/auth/auth.service';
import type { Prisma } from '@prisma/client';

type RequestWithAccount = Request & { account?: JwtPayload; user?: JwtPayload };

function normalizeIpString(raw: string): string {
  const ip = String(raw || '').trim();
  if (!ip) return '';
  // Convert IPv6 loopback to IPv4 loopback for readability.
  if (ip === '::1') return '127.0.0.1';
  // Convert IPv4-mapped IPv6 addresses like ::ffff:192.168.1.10 to 192.168.1.10
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped?.[1]) return mapped[1];
  return ip;
}

function normalizeIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  const first =
    typeof xff === 'string'
      ? xff.split(',')[0]?.trim()
      : Array.isArray(xff)
        ? String(xff[0] || '')
            .split(',')[0]
            ?.trim()
        : '';
  const raw = first || req.ip || req.socket.remoteAddress || '';
  const normalized = normalizeIpString(raw);
  return normalized || null;
}

function safeJsonClone(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v)) as unknown;
  } catch {
    return null;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function redactSecrets(value: unknown): Prisma.InputJsonValue | undefined {
  const cloned = safeJsonClone(value);
  const deny = new Set([
    'password',
    'passwordhash',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'cookie',
    'set-cookie',
  ]);

  const walk = (node: unknown): Prisma.InputJsonValue | undefined => {
    if (node === null || node === undefined) return undefined;
    if (typeof node !== 'object') return node as Prisma.InputJsonValue;
    if (Array.isArray(node)) {
      const arr: Prisma.InputJsonValue[] = [];
      for (const item of node) {
        const walked = walk(item);
        if (walked !== undefined) arr.push(walked);
      }
      return arr;
    }
    if (!isRecord(node)) return undefined;
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, v] of Object.entries(node)) {
      const key = String(k);
      if (deny.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
        continue;
      }
      const walked = walk(v);
      if (walked !== undefined) out[key] = walked;
    }
    return out;
  };

  return walk(cloned);
}

function actionFromMethod(method: string): string | null {
  const m = String(method || '').toUpperCase();
  if (m === 'POST') return 'CREATE';
  if (m === 'PUT' || m === 'PATCH') return 'UPDATE';
  if (m === 'DELETE') return 'DELETE';
  return null;
}

function entityTypeFromPath(path: string): string {
  const p = String(path || '').split('?')[0] || '';
  const segs = p.split('/').filter(Boolean);
  // expected: /api/admin/<entity>/...
  const adminIdx = segs.findIndex((s) => s === 'admin');
  if (adminIdx >= 0 && segs[adminIdx + 1]) return segs[adminIdx + 1];
  return 'admin';
}

function guessEntityId(params: Record<string, unknown>): string | null {
  const keys = [
    'id',
    'orderId',
    'enterpriseId',
    'ticketId',
    'invitationId',
    'voucherId',
    'ruleId',
  ];
  for (const k of keys) {
    const v = params?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithAccount>();
    const res = http.getResponse<Response>();

    const path = String(req.originalUrl || req.url || req.path || '');
    const action = actionFromMethod(req.method);

    // Only admin write requests.
    if (!path.includes('/admin/') || !action) {
      return next.handle();
    }

    const account = req.account ?? req.user;
    const actorAccountId = account?.accountId || null;
    const ip = normalizeIp(req);
    const entityType = entityTypeFromPath(path);
    const entityId = guessEntityId(isRecord(req.params) ? req.params : {});
    const summary = `${action} ${entityType}${entityId ? `:${entityId}` : ''}`;
    const metadata = redactSecrets({
      params: req.params as unknown,
      query: req.query as unknown,
      body: req.body as unknown,
    });

    const writeAuditLog = (isSuccess: boolean) => {
      const auditLogCreateData = {
        ActorAccountID: actorAccountId,
        Action: action,
        EntityType: entityType,
        EntityId: entityId,
        Summary: summary,
        IpAddress: ip,
        Success: isSuccess && (res.statusCode || 200) < 400,
        ...(metadata !== undefined ? { Metadata: metadata } : {}),
      } satisfies Prisma.AuditLogUncheckedCreateInput;

      void this.prisma.auditLog
        .create({
          data: auditLogCreateData,
        })
        .catch(() => {});
    };

    return next.handle().pipe(
      tap({
        error: () => writeAuditLog(false),
        complete: () => writeAuditLog(true),
      }),
    );
  }
}
