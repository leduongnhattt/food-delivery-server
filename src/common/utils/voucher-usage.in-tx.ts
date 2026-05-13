import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Atomically increment voucher usage after order is committed to this voucher. */
export async function incrementVoucherUsedCountInTx(
  tx: Prisma.TransactionClient,
  voucherId: string,
): Promise<void> {
  const v = await tx.voucher.findUnique({
    where: { VoucherID: voucherId },
    select: { UsedCount: true, MaxUsage: true },
  });
  if (!v) {
    throw new BadRequestException('Voucher no longer exists');
  }
  if (v.MaxUsage != null && v.UsedCount >= v.MaxUsage) {
    throw new BadRequestException('Voucher usage limit has been reached');
  }
  await tx.voucher.update({
    where: { VoucherID: voucherId },
    data: { UsedCount: { increment: 1 } },
  });
}
