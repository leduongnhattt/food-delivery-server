import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { JwtPayload } from '@modules/auth/auth.service';

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
        ? String(xff[0] || '').split(',')[0]?.trim()
        : '';
  const raw = first || req.ip || (req.socket as any)?.remoteAddress || '';
  const normalized = normalizeIpString(raw);
  return normalized || null;
}

function safeJsonClone(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

function redactSecrets(value: unknown): unknown {
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

  const walk = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (deny.has(String(k).toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = walk(v);
      }
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

function guessEntityId(params: Record<string, any>): string | null {
  const keys = ['id', 'orderId', 'enterpriseId', 'ticketId', 'invitationId', 'voucherId', 'ruleId'];
  for (const k of keys) {
    const v = params?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithAccount>();
    const res = http.getResponse<Response>();

    const path = String((req as any).originalUrl || req.url || req.path || '');
    const action = actionFromMethod(req.method);

    // Only admin write requests.
    if (!path.includes('/admin/') || !action) {
      return next.handle();
    }

    const account = req.account ?? req.user;
    const actorAccountId = account?.accountId || null;
    const ip = normalizeIp(req);
    const entityType = entityTypeFromPath(path);
    const entityId = guessEntityId(req.params as any);
    const summary = `${action} ${entityType}${entityId ? `:${entityId}` : ''}`;
    const metadata = redactSecrets({
      params: req.params,
      query: req.query,
      body: req.body,
    });

    let success = true;

    return next.handle().pipe(
      catchError((err) => {
        success = false;
        throw err;
      }),
      finalize(() => {
        // Fire-and-forget; do not break request pipeline.
        void this.prisma.auditLog
          .create({
            data: {
              ActorAccountID: actorAccountId,
              Action: action,
              EntityType: entityType,
              EntityId: entityId,
              Summary: summary,
              Metadata: metadata as any,
              IpAddress: ip,
              Success: success && (res.statusCode || 200) < 400,
            },
          })
          .catch(() => {});
      }),
    );
  }
}

