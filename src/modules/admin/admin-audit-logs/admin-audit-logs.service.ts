import { Injectable } from '@nestjs/common';
import { Prisma, AuditLog } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

type AuditStatusFilter = 'all' | 'success' | 'failure';
type AuditRangePreset = 'last30' | 'last7' | 'today' | 'custom';
type SortOrder = 'asc' | 'desc';

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(23, 59, 59, 999);
  return out;
}

function parseRange(params: {
  range?: string;
  from?: string;
  to?: string;
}): { from?: Date; to?: Date; range: AuditRangePreset } {
  const rawRange = String(params.range || 'last30').trim().toLowerCase();
  const range: AuditRangePreset =
    rawRange === 'last7' || rawRange === 'today' || rawRange === 'custom'
      ? (rawRange as AuditRangePreset)
      : 'last30';

  const now = new Date();

  if (range === 'today') {
    return { range, from: startOfDay(now), to: endOfDay(now) };
  }
  if (range === 'last7') {
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 7);
    return { range, from: fromDate, to: now };
  }
  if (range === 'custom') {
    const fromInput = params.from ? new Date(params.from) : undefined;
    const toInput = params.to ? new Date(params.to) : undefined;
    return {
      range,
      from:
        fromInput && !isNaN(fromInput.getTime()) ? fromInput : undefined,
      to: toInput && !isNaN(toInput.getTime()) ? toInput : undefined,
    };
  }
  // last30 default
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 30);
  return { range: 'last30', from: fromDate, to: now };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(headers.map((headerKey) => csvEscape(row[headerKey])).join(','));
  }
  // Add UTF-8 BOM for Excel compatibility.
  return '\uFEFF' + lines.join('\r\n');
}

export type AdminAuditLogRow = {
  AuditLogID: string;
  CreatedAt: string;
  User: string;
  Role: string;
  Module: string;
  Action: string;
  Status: 'Success' | 'Failure';
  Description: string;
  IpAddress: string;
};

@Injectable()
export class AdminAuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(params: {
    search?: string;
    user?: string;
    role?: string;
    module?: string;
    action?: string;
    status?: string;
    range?: string;
    from?: string;
    to?: string;
  }): Prisma.AuditLogWhereInput {
    const searchQuery = String(params.search || '').trim();
    const statusFilter = String(params.status || 'all')
      .trim()
      .toLowerCase() as AuditStatusFilter;
    const { from, to } = parseRange({ range: params.range, from: params.from, to: params.to });

    const where: Prisma.AuditLogWhereInput = {};

    if (searchQuery) {
      where.OR = [
        { Summary: { contains: searchQuery } },
        { IpAddress: { contains: searchQuery } },
      ];
    }

    if (params.user) {
      where.ActorAccountID = String(params.user);
    }

    if (params.role) {
      where.account = { role: { RoleName: String(params.role) } };
    }

    if (params.module) {
      where.EntityType = String(params.module);
    }

    if (params.action) {
      where.Action = String(params.action);
    }

    if (statusFilter === 'success') where.Success = true;
    if (statusFilter === 'failure') where.Success = false;

    if (from || to) {
      where.CreatedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    return where;
  }

  private mapRow(row: AuditLog & {
    account: { Username: string; Email: string; role: { RoleName: string } } | null;
  }): AdminAuditLogRow {
    const user = row.account?.Username || row.account?.Email || '—';
    const role = row.account?.role?.RoleName || '—';
    const module = row.EntityType?.trim() || '—';
    const ip = row.IpAddress?.trim() || '—';
    return {
      AuditLogID: row.AuditLogID,
      CreatedAt: row.CreatedAt.toISOString(),
      User: user,
      Role: role,
      Module: module,
      Action: row.Action,
      Status: row.Success ? 'Success' : 'Failure',
      Description: row.Summary,
      IpAddress: ip,
    };
  }

  async list(params: {
    search?: string;
    user?: string;
    role?: string;
    module?: string;
    action?: string;
    status?: string;
    range?: string;
    from?: string;
    to?: string;
    page?: string;
    limit?: string;
    order?: string;
  }) {
    const pageNumber = Math.max(1, toInt(params.page, 1));
    const pageSize = clamp(toInt(params.limit, 12), 5, 50);
    const sortOrder =
      String(params.order || 'desc').toLowerCase() === 'asc'
        ? ('asc' as SortOrder)
        : ('desc' as SortOrder);
    const whereClause = this.buildWhere(params);

    const [total, auditLogRows] = await Promise.all([
      this.prisma.auditLog.count({ where: whereClause }),
      this.prisma.auditLog.findMany({
        where: whereClause,
        orderBy: { CreatedAt: sortOrder },
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
        include: {
          account: { select: { Username: true, Email: true, role: { select: { RoleName: true } } } },
        },
      }),
    ]);

    return {
      items: auditLogRows.map((row) => this.mapRow(row as any)),
      total,
      page: pageNumber,
      limit: pageSize,
    };
  }

  async options() {
    const defaultModules = [
      'customers',
      'enterprises',
      'enterprise-invitations',
      'orders',
      'support',
      'vouchers',
      'reviews',
      'dashboard',
      'finance',
      'commission-fees',
      'transaction-fees',
      'payout-requests',
      'audit-logs',
      'settings',
      'registry',
    ];
    const defaultActions = ['CREATE', 'UPDATE', 'DELETE'];

    const [groupedUsers, roleRows, groupedModules, groupedActions] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['ActorAccountID'],
        where: { ActorAccountID: { not: null } },
      }),
      this.prisma.role.findMany({ select: { RoleName: true }, orderBy: { RoleName: 'asc' } }),
      this.prisma.auditLog.groupBy({
        by: ['EntityType'],
        where: { EntityType: { not: null } },
      }),
      this.prisma.auditLog.groupBy({ by: ['Action'] }),
    ]);

    const userIds = groupedUsers.map((row) => row.ActorAccountID!).filter(Boolean);
    const accounts = userIds.length
      ? await this.prisma.account.findMany({
        where: { AccountID: { in: userIds } },
        select: { AccountID: true, Username: true, Email: true },
      })
      : [];

    const accountLabelById = new Map(
      accounts.map((a) => [a.AccountID, (a.Username || a.Email || a.AccountID) as string]),
    );

    return {
      users: userIds
        .map((id) => ({ id, label: accountLabelById.get(id) ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      roles: roleRows.map((row) => row.RoleName),
      modules: Array.from(
        new Set(
          defaultModules.concat(
            groupedModules
              .map((row) => String(row.EntityType || '').trim())
              .filter(Boolean),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
      actions: Array.from(
        new Set(
          defaultActions.concat(
            groupedActions
              .map((row) => row.Action)
              .filter(Boolean),
          ),
        ),
      ).sort((a, b) => a.localeCompare(b)),
      statuses: ['All Statuses', 'Success', 'Failure'],
      ranges: [
        { id: 'last30', label: 'Last 30 days' },
        { id: 'last7', label: 'Last 7 days' },
        { id: 'today', label: 'Today' },
        { id: 'custom', label: 'Custom' },
      ],
    };
  }

  async exportCsv(params: {
    search?: string;
    user?: string;
    role?: string;
    module?: string;
    action?: string;
    status?: string;
    range?: string;
    from?: string;
    to?: string;
    order?: string;
  }) {
    const sortOrder =
      String(params.order || 'desc').toLowerCase() === 'asc'
        ? ('asc' as SortOrder)
        : ('desc' as SortOrder);
    const whereClause = this.buildWhere(params);
    const auditLogRows = await this.prisma.auditLog.findMany({
      where: whereClause,
      orderBy: { CreatedAt: sortOrder },
      take: 5000,
      include: {
        account: { select: { Username: true, Email: true, role: { select: { RoleName: true } } } },
      },
    });

    const mappedRows = auditLogRows.map((row) => this.mapRow(row as any));
    const csvHeaders = ['Timestamp', 'User', 'Role', 'Module', 'Action', 'Status', 'Description', 'IP Address'];
    const csvRows = mappedRows.map((row) => ({
      Timestamp: row.CreatedAt,
      User: row.User,
      Role: row.Role,
      Module: row.Module,
      Action: row.Action,
      Status: row.Status,
      Description: row.Description,
      'IP Address': row.IpAddress,
    }));
    return buildCsv(csvRows, csvHeaders);
  }
}

