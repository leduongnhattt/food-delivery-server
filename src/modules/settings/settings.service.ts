import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private toInputJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
    // Prisma expects JsonNull wrapper instead of raw null.
    if (value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }

  private safeParseJson<T>(value: unknown): T | null {
    if (value == null) return null;
    if (typeof value === 'object') return value as T;
    if (typeof value !== 'string') return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({
      where: { Key: key },
      select: { Value: true },
    });
    return this.safeParseJson<T>(row?.Value);
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { Key: key },
      create: { Key: key, Value: this.toInputJsonValue(value) },
      update: { Value: this.toInputJsonValue(value) },
    });
  }
}

