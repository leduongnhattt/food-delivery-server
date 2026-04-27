import { BadRequestException } from '@nestjs/common';
import { asTrimmedString } from './parse.utils';

/**
 * Shared helpers for finance rules (commission + transaction fee).
 * Keep error messages stable to avoid changing API behavior.
 */

export function parsePercentRequired(
  value: unknown,
  opts: {
    requiredMessage: string;
    outOfRangeMessage: string;
  },
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0 || value > 100) {
      throw new BadRequestException(opts.outOfRangeMessage);
    }
    return Math.round(value * 100) / 100;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new BadRequestException(opts.outOfRangeMessage);
    }
    return Math.round(n * 100) / 100;
  }
  throw new BadRequestException(opts.requiredMessage);
}

export function parseDateOnlyStart(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

export function parseDateOnlyEnd(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(`${s}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

export function parseDateOnlyRequired(value: unknown, field: string): Date {
  const s = asTrimmedString(value);
  if (!s) throw new BadRequestException(`${field} is required`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return d;
}

export function parseOptionalDateTime(value: unknown): Date | null {
  const s = asTrimmedString(value);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Invalid date value');
  }
  return d;
}

export function todayDateOnlyUtc(): Date {
  const t = new Date();
  return new Date(`${t.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function addDaysUtc(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isSameDateOnly(a: Date, b: Date): boolean {
  return toDateOnlyString(a) === toDateOnlyString(b);
}

