import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: { accountId: string; subject: string; description: string }) {
    return this.prisma.support.create({
      data: {
        AccountID: params.accountId,
        Subject: params.subject,
        Description: params.description,
      },
      select: { MessageID: true },
    });
  }
}

