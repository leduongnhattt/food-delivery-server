import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infra/prisma/prisma.service';
import { PayoutDestinationKind, Prisma } from '@prisma/client';
import { VN_BANK_NAMES } from '@common/constants/vn-bank-names.constants';
import { asBoolean, asTrimmedString } from '@common/utils/parse.utils';
import {
  isCountryCode2,
  isDigitsOnly,
  isEmail,
  isHolderNameLike,
  isStripeAccountId,
} from '@common/utils/validation.utils';

const PROVIDER_ALLOWLIST = new Set<string>(['stripe', 'paypal']);

@Injectable()
export class EnterpriseBankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getEnterpriseIdByAccountId(accountId: string): Promise<string> {
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { AccountID: accountId, DeletedAt: null },
      select: { EnterpriseID: true },
    });
    if (!enterprise) throw new NotFoundException('Enterprise not found');
    return enterprise.EnterpriseID;
  }

  async list(accountId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const rows = await this.prisma.enterprisePayoutDestination.findMany({
      where: { EnterpriseID: enterpriseId, IsActive: true },
      orderBy: [{ IsDefault: 'desc' }, { CreatedAt: 'desc' }],
    });

    return {
      success: true,
      bankAccounts: rows.map((r) => ({
        id: r.PayoutDestinationID,
        kind: r.Kind,
        label: r.Label ?? null,
        isDefault: r.IsDefault,
        isActive: r.IsActive,
        verifiedAt: r.VerifiedAt?.toISOString() ?? null,
        createdAt: r.CreatedAt.toISOString(),
        updatedAt: r.UpdatedAt?.toISOString() ?? null,
        bankName: r.BankName ?? null,
        bankCode: r.BankCode ?? null,
        accountHolderName: r.AccountHolderName ?? null,
        accountNumber: r.AccountNumber ?? null,
        branchName: r.BranchName ?? null,
        countryCode: r.CountryCode ?? null,
        providerCode: r.ProviderCode ?? null,
        walletRef: r.WalletRef ?? null,
        walletDisplayName: r.WalletDisplayName ?? null,
        detailMetadata: r.DetailMetadata ?? null,
      })),
    };
  }

  async create(
    accountId: string,
    body: {
      kind?: unknown;
      bankName?: unknown;
      bankCode?: unknown;
      accountHolderName?: unknown;
      accountNumber?: unknown;
      branchName?: unknown;
      countryCode?: unknown;
      providerCode?: unknown;
      walletRef?: unknown;
      walletDisplayName?: unknown;
      isDefault?: unknown;
      label?: unknown;
    },
  ) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const kindRaw = asTrimmedString(body.kind);
    const kind =
      kindRaw === 'BankAccount'
        ? PayoutDestinationKind.BankAccount
        : kindRaw === 'EWallet'
          ? PayoutDestinationKind.EWallet
          : null;
    if (!kind) throw new BadRequestException('kind must be BankAccount or EWallet');

    const isDefault = asBoolean(body.isDefault) ?? false;
    const label = asTrimmedString(body.label);

    const countryCodeRaw = asTrimmedString(body.countryCode);
    const countryCode = countryCodeRaw ? countryCodeRaw.toUpperCase() : null;
    if (countryCode && !isCountryCode2(countryCode)) {
      throw new BadRequestException('countryCode must be ISO-3166 alpha-2');
    }

    const bankName = asTrimmedString(body.bankName);
    const bankCode = asTrimmedString(body.bankCode);
    const accountHolderName = asTrimmedString(body.accountHolderName);
    const accountNumber = asTrimmedString(body.accountNumber);
    const branchName = asTrimmedString(body.branchName);

    const providerCode = asTrimmedString(body.providerCode);
    const walletRef = asTrimmedString(body.walletRef);
    const walletDisplayName = asTrimmedString(body.walletDisplayName);

    if (kind === PayoutDestinationKind.BankAccount) {
      if (!bankName) throw new BadRequestException('bankName is required');
      if (!accountHolderName) throw new BadRequestException('accountHolderName is required');
      if (!accountNumber) throw new BadRequestException('accountNumber is required');
      // Default to Vietnam unless explicitly provided.
      const cc = countryCode ?? 'VN';
      if (cc === 'VN' && !VN_BANK_NAMES.has(bankName)) {
        throw new BadRequestException('bankName is not supported');
      }
      if (!isHolderNameLike(accountHolderName) || accountHolderName.length > 120) {
        throw new BadRequestException('accountHolderName is invalid');
      }
      if (!isDigitsOnly(accountNumber) || accountNumber.length < 10 || accountNumber.length > 20) {
        throw new BadRequestException('accountNumber is invalid');
      }

      const dup = await this.prisma.enterprisePayoutDestination.findFirst({
        where: {
          EnterpriseID: enterpriseId,
          Kind: PayoutDestinationKind.BankAccount,
          BankName: bankName,
          AccountNumber: accountNumber,
          IsActive: true,
        },
        select: { PayoutDestinationID: true },
      });
      if (dup) throw new ConflictException('Bank account already exists');

      const created = await this.prisma.$transaction(async (tx) => {
        if (isDefault) {
          await tx.enterprisePayoutDestination.updateMany({
            where: { EnterpriseID: enterpriseId, IsDefault: true },
            data: { IsDefault: false },
          });
        }

        return tx.enterprisePayoutDestination.create({
          data: {
            EnterpriseID: enterpriseId,
            Kind: PayoutDestinationKind.BankAccount,
            Label: label,
            IsDefault: isDefault,
            IsActive: true,
            BankName: bankName,
            BankCode: bankCode,
            AccountHolderName: accountHolderName,
            AccountNumber: accountNumber,
            BranchName: branchName,
            CountryCode: cc,
          },
        });
      });

      return { success: true, id: created.PayoutDestinationID };
    }

    // EWallet / Provider payout (e.g. Stripe for international)
    if (!providerCode) throw new BadRequestException('providerCode is required for EWallet');
    const provider = providerCode.trim().toLowerCase();
    if (!PROVIDER_ALLOWLIST.has(provider)) {
      throw new BadRequestException('providerCode is not supported');
    }
    if (!walletRef) throw new BadRequestException('walletRef is required for provider');
    const ref = walletRef.trim();
    if (provider === 'stripe' && !isStripeAccountId(ref)) {
      throw new BadRequestException('walletRef is invalid for Stripe');
    }
    if (provider === 'paypal' && !isEmail(ref)) {
      throw new BadRequestException('walletRef is invalid for PayPal');
    }

    const dup = await this.prisma.enterprisePayoutDestination.findFirst({
      where: {
        EnterpriseID: enterpriseId,
        Kind: PayoutDestinationKind.EWallet,
        ProviderCode: provider,
        WalletRef: provider === 'paypal' ? ref.toLowerCase() : ref,
        IsActive: true,
      },
      select: { PayoutDestinationID: true },
    });
    if (dup) throw new ConflictException('Payout destination already exists');

    const created = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.enterprisePayoutDestination.updateMany({
          where: { EnterpriseID: enterpriseId, IsDefault: true },
          data: { IsDefault: false },
        });
      }

      return tx.enterprisePayoutDestination.create({
        data: {
          EnterpriseID: enterpriseId,
          Kind: PayoutDestinationKind.EWallet,
          Label: label,
          IsDefault: isDefault,
          IsActive: true,
          CountryCode: countryCode,
          ProviderCode: provider,
          WalletRef: provider === 'paypal' ? ref.toLowerCase() : ref,
          WalletDisplayName: walletDisplayName,
        },
      });
    });

    return { success: true, id: created.PayoutDestinationID };
  }

  async update(
    accountId: string,
    payoutDestinationId: string,
    body: {
      isDefault?: unknown;
      isActive?: unknown;
      label?: unknown;
      bankName?: unknown;
      bankCode?: unknown;
      accountHolderName?: unknown;
      accountNumber?: unknown;
      branchName?: unknown;
      countryCode?: unknown;
      providerCode?: unknown;
      walletRef?: unknown;
      walletDisplayName?: unknown;
    },
  ) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const id = (payoutDestinationId || '').trim();
    if (!id) throw new BadRequestException('id is required');

    const row = await this.prisma.enterprisePayoutDestination.findFirst({
      where: { PayoutDestinationID: id, EnterpriseID: enterpriseId },
      select: {
        PayoutDestinationID: true,
        Kind: true,
        IsDefault: true,
        IsActive: true,
        BankName: true,
        AccountNumber: true,
        ProviderCode: true,
        WalletRef: true,
      },
    });
    if (!row) throw new NotFoundException('Bank account not found');

    const nextIsDefault = asBoolean(body.isDefault);
    const nextIsActive = asBoolean(body.isActive);
    const label = asTrimmedString(body.label);

    if (nextIsDefault === false && row.IsDefault) {
      throw new ConflictException('Cannot unset default without selecting another default');
    }
    if (nextIsActive === false && row.IsDefault) {
      throw new ConflictException('Cannot deactivate default bank account');
    }
    if (nextIsDefault === true && nextIsActive === false) {
      throw new ConflictException('Default bank account must be active');
    }

    const countryCodeRaw = asTrimmedString(body.countryCode);
    const countryCode = countryCodeRaw ? countryCodeRaw.toUpperCase() : null;
    if (countryCode && !isCountryCode2(countryCode)) {
      throw new BadRequestException('countryCode must be ISO-3166 alpha-2');
    }

    const bankName = asTrimmedString(body.bankName);
    const bankCode = asTrimmedString(body.bankCode);
    const accountHolderName = asTrimmedString(body.accountHolderName);
    const accountNumber = asTrimmedString(body.accountNumber);
    const branchName = asTrimmedString(body.branchName);

    const providerCode = asTrimmedString(body.providerCode);
    const walletRef = asTrimmedString(body.walletRef);
    const walletDisplayName = asTrimmedString(body.walletDisplayName);

    if (row.Kind === PayoutDestinationKind.BankAccount) {
      const nextBankName = bankName ?? row.BankName ?? null;
      const nextAccountNumber = accountNumber ?? row.AccountNumber ?? null;

      if (nextBankName && (countryCode ?? 'VN') === 'VN' && !VN_BANK_NAMES.has(nextBankName)) {
        throw new BadRequestException('bankName is not supported');
      }
      if (accountHolderName != null) {
        if (!accountHolderName || !isHolderNameLike(accountHolderName) || accountHolderName.length > 120) {
          throw new BadRequestException('accountHolderName is invalid');
        }
      }
      if (accountNumber != null) {
        if (!accountNumber || !isDigitsOnly(accountNumber) || accountNumber.length < 10 || accountNumber.length > 20) {
          throw new BadRequestException('accountNumber is invalid');
        }
      }
      if (bankName != null && !bankName) throw new BadRequestException('bankName is required');

      // Duplicate check if key fields changed
      if (nextBankName && nextAccountNumber) {
        const dup = await this.prisma.enterprisePayoutDestination.findFirst({
          where: {
            EnterpriseID: enterpriseId,
            Kind: PayoutDestinationKind.BankAccount,
            BankName: nextBankName,
            AccountNumber: nextAccountNumber,
            IsActive: true,
            NOT: { PayoutDestinationID: id },
          },
          select: { PayoutDestinationID: true },
        });
        if (dup) throw new ConflictException('Bank account already exists');
      }
    } else {
      const nextProvider = (providerCode ?? row.ProviderCode ?? '').trim().toLowerCase();
      const nextRef = walletRef ?? row.WalletRef ?? null;
      if (providerCode != null) {
        if (!providerCode) throw new BadRequestException('providerCode is required for EWallet');
      }
      if (!nextProvider || !PROVIDER_ALLOWLIST.has(nextProvider)) {
        throw new BadRequestException('providerCode is not supported');
      }
      if (walletRef != null) {
        if (!walletRef) throw new BadRequestException('walletRef is required for provider');
      }
      if (nextRef) {
        const ref = nextRef.trim();
        if (nextProvider === 'stripe' && !isStripeAccountId(ref)) {
          throw new BadRequestException('walletRef is invalid for Stripe');
        }
        if (nextProvider === 'paypal' && !isEmail(ref)) {
          throw new BadRequestException('walletRef is invalid for PayPal');
        }
        const normalizedRef = nextProvider === 'paypal' ? ref.toLowerCase() : ref;
        const dup = await this.prisma.enterprisePayoutDestination.findFirst({
          where: {
            EnterpriseID: enterpriseId,
            Kind: PayoutDestinationKind.EWallet,
            ProviderCode: nextProvider,
            WalletRef: normalizedRef,
            IsActive: true,
            NOT: { PayoutDestinationID: id },
          },
          select: { PayoutDestinationID: true },
        });
        if (dup) throw new ConflictException('Payout destination already exists');
      }
    }

    const data: Prisma.EnterprisePayoutDestinationUpdateInput = {
      ...(label !== null ? { Label: label } : {}),
      ...(nextIsActive !== null ? { IsActive: nextIsActive } : {}),
      ...(nextIsDefault !== null ? { IsDefault: nextIsDefault } : {}),
      ...(countryCode !== null ? { CountryCode: countryCode } : {}),
      ...(bankName !== null ? { BankName: bankName } : {}),
      ...(bankCode !== null ? { BankCode: bankCode } : {}),
      ...(accountHolderName !== null ? { AccountHolderName: accountHolderName } : {}),
      ...(accountNumber !== null ? { AccountNumber: accountNumber } : {}),
      ...(branchName !== null ? { BranchName: branchName } : {}),
      ...(providerCode !== null ? { ProviderCode: providerCode.trim().toLowerCase() } : {}),
      ...(walletRef !== null ? { WalletRef: row.Kind === PayoutDestinationKind.EWallet && (providerCode ?? row.ProviderCode)?.trim().toLowerCase() === 'paypal' ? walletRef.toLowerCase() : walletRef } : {}),
      ...(walletDisplayName !== null ? { WalletDisplayName: walletDisplayName } : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      if (nextIsDefault === true) {
        await tx.enterprisePayoutDestination.updateMany({
          where: { EnterpriseID: enterpriseId, IsDefault: true },
          data: { IsDefault: false },
        });
      }
      await tx.enterprisePayoutDestination.update({
        where: { PayoutDestinationID: id },
        data,
      });
    });

    return { success: true };
  }

  async delete(accountId: string, payoutDestinationId: string) {
    const enterpriseId = await this.getEnterpriseIdByAccountId(accountId);
    const id = (payoutDestinationId || '').trim();
    if (!id) throw new BadRequestException('id is required');

    const row = await this.prisma.enterprisePayoutDestination.findFirst({
      where: { PayoutDestinationID: id, EnterpriseID: enterpriseId },
      select: { PayoutDestinationID: true, IsDefault: true },
    });
    if (!row) throw new NotFoundException('Bank account not found');
    if (row.IsDefault) {
      throw new ConflictException('Cannot delete default bank account');
    }

    await this.prisma.enterprisePayoutDestination.update({
      where: { PayoutDestinationID: id },
      data: { IsActive: false },
    });

    return { success: true };
  }
}

