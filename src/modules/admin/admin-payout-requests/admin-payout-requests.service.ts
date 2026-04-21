import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import {
  EnterpriseLedgerEntryStatus,
  EnterprisePayoutRequestStatus,
  Prisma,
} from '@prisma/client';
import { asTrimmedString } from '@common/utils/parse.utils';

function parseTargetStatus(v: unknown): EnterprisePayoutRequestStatus {
  const raw = asTrimmedString(v);
  if (!raw) throw new BadRequestException('status is required');
  const allowed: EnterprisePayoutRequestStatus[] = [
    EnterprisePayoutRequestStatus.Approved,
    EnterprisePayoutRequestStatus.Rejected,
    EnterprisePayoutRequestStatus.Processing,
    EnterprisePayoutRequestStatus.Paid,
    EnterprisePayoutRequestStatus.Failed,
  ];
  if (!allowed.includes(raw as any)) {
    throw new BadRequestException(`Invalid status: ${raw}`);
  }
  return raw as EnterprisePayoutRequestStatus;
}

function mapToLedgerStatus(
  s: EnterprisePayoutRequestStatus,
): EnterpriseLedgerEntryStatus {
  if (s === EnterprisePayoutRequestStatus.Approved) return EnterpriseLedgerEntryStatus.Approved;
  if (s === EnterprisePayoutRequestStatus.Rejected) return EnterpriseLedgerEntryStatus.Rejected;
  if (s === EnterprisePayoutRequestStatus.Processing) return EnterpriseLedgerEntryStatus.Processing;
  if (s === EnterprisePayoutRequestStatus.Paid) return EnterpriseLedgerEntryStatus.Paid;
  if (s === EnterprisePayoutRequestStatus.Failed) return EnterpriseLedgerEntryStatus.Failed;
  return EnterpriseLedgerEntryStatus.Pending;
}

@Injectable()
export class AdminPayoutRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async updateStatus(
    adminAccountId: string,
    payoutRequestId: string,
    body: { status?: unknown; adminNote?: unknown; failureMessage?: unknown },
  ) {
    const id = (payoutRequestId || '').trim();
    if (!id) throw new BadRequestException('id is required');
    const nextStatus = parseTargetStatus(body.status);
    const adminNote = asTrimmedString(body.adminNote);
    const failureMessage = asTrimmedString(body.failureMessage);

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.enterprisePayoutRequest.findUnique({
        where: { PayoutRequestID: id },
        select: {
          PayoutRequestID: true,
          EnterpriseID: true,
          SettlementID: true,
          Status: true,
          ExpiresAt: true,
          Amount: true,
          Currency: true,
          PaidAt: true,
        },
      });
      if (!row) throw new NotFoundException('Payout request not found');

      if (row.Status === EnterprisePayoutRequestStatus.Expired) {
        throw new ConflictException('Payout request is expired');
      }
      if (row.ExpiresAt && row.ExpiresAt.getTime() <= now.getTime()) {
        throw new ConflictException('Payout request is expired');
      }

      // Basic transition guard
      const allowedFrom = new Set<EnterprisePayoutRequestStatus>([
        EnterprisePayoutRequestStatus.Pending,
        EnterprisePayoutRequestStatus.Approved,
        EnterprisePayoutRequestStatus.Processing,
      ]);
      if (!allowedFrom.has(row.Status)) {
        throw new ConflictException(`Cannot transition from ${row.Status}`);
      }

      const data: Prisma.EnterprisePayoutRequestUpdateInput = {
        Status: nextStatus,
        ...(adminNote ? { AdminNote: adminNote } : {}),
        ...(nextStatus === EnterprisePayoutRequestStatus.Failed && failureMessage
          ? { FailureMessage: failureMessage }
          : {}),
        ...(nextStatus === EnterprisePayoutRequestStatus.Approved ? { ApprovedAt: now } : {}),
        ...(nextStatus === EnterprisePayoutRequestStatus.Paid ? { PaidAt: now } : {}),
      };

      const req = await tx.enterprisePayoutRequest.update({
        where: { PayoutRequestID: id },
        data,
        select: {
          PayoutRequestID: true,
          EnterpriseID: true,
          SettlementID: true,
          Status: true,
          Amount: true,
          Currency: true,
          PaidAt: true,
        },
      });

      // Update corresponding ledger entry (Withdrawal request)
      await tx.enterpriseLedgerEntry.updateMany({
        where: { PayoutRequestID: id },
        data: { Status: mapToLedgerStatus(nextStatus) },
      });

      // Mark settlement as completed/paid on Paid
      if (nextStatus === EnterprisePayoutRequestStatus.Paid && req.SettlementID) {
        await tx.settlement.update({
          where: { SettlementID: req.SettlementID },
          data: {
            Status: 'Completed',
            PaidAt: now,
            TransactionID: `payout_request:${id}`,
          },
        });
      }

      return req;
    });

    return {
      success: true,
      payoutRequest: {
        id: updated.PayoutRequestID,
        status: String(updated.Status),
        amount: Number(updated.Amount),
        currency: updated.Currency,
        paidAt: updated.PaidAt ? updated.PaidAt.toISOString() : null,
        handledByAdminAccountId: adminAccountId,
      },
    };
  }
}

