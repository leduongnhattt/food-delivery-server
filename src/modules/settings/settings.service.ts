import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getJson<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({
      where: { Key: key },
      select: { Value: true },
    });
    return (row?.Value as T | undefined) ?? null;
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { Key: key },
      create: { Key: key, Value: value as any },
      update: { Value: value as any },
    });
  }
}

