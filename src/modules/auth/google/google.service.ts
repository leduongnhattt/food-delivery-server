import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AuthRepository } from '@infra/repositories/auth.repository';

export interface GoogleUserInfo {
  email: string;
  googleId: string;
  name: string;
  picture?: string;
}

@Injectable()
export class AuthGoogleService {
  constructor(private readonly authRepo: AuthRepository) {}

  private generateUsernameFromEmail(email: string): string {
    const prefix = email.split('@')[0].toLowerCase();
    const clean = prefix
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return clean.length < 3 ? `user_${clean}` : clean;
  }

  private getGoogleClient(): OAuth2Client {
    return new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  async verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
    const client = this.getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      throw new Error('Invalid Google token payload');
    }
    return {
      email: payload.email,
      googleId: payload.sub,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture,
    };
  }

  private async findGoogleUserByGoogleId(googleId: string) {
    return this.authRepo.findAccountByGoogleId(googleId);
  }

  private async findAccountByEmail(email: string) {
    return this.authRepo.findAccountByEmail(email, true);
  }

  private async linkGoogleToExistingAccount(
    accountId: string,
    googleUser: GoogleUserInfo,
  ) {
    await this.authRepo.updateAccount(accountId, {
      Provider: 'google',
      ProviderAccountId: googleUser.googleId,
      EmailVerified: true,
      LastLogin: new Date(),
      Avatar: googleUser.picture || undefined,
    });
    const existing = await this.authRepo.findCustomerByAccountId(accountId);
    if (!existing) {
      try {
        await this.authRepo.createCustomer({
          AccountID: accountId,
          FullName: googleUser.name,
          PhoneNumber: '00000000000',
          Address: 'Default Address',
          PreferredPaymentMethod: 'Cash',
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (
          msg.includes('CUSTOMER_PhoneNumber') ||
          msg.includes('PhoneNumber')
        ) {
          await this.authRepo.createCustomer({
            AccountID: accountId,
            FullName: googleUser.name,
            PhoneNumber: '00000000001',
            Address: 'Default Address',
            PreferredPaymentMethod: 'Cash',
          });
        } else {
          throw e;
        }
      }
    }
    return this.authRepo.findAccountById(accountId, { withRole: true });
  }

  private async createGoogleAccount(googleUser: GoogleUserInfo) {
    const customerRole = await this.authRepo.findRoleByName('Customer');
    if (!customerRole) throw new Error('Customer role not found');
    const username = this.generateUsernameFromEmail(googleUser.email);
    const existing = await this.authRepo.findAccountByUsernameRaw(username);
    if (existing) {
      throw new Error(
        `Username '${username}' already exists. Please contact support.`,
      );
    }
    const newAccount = await this.authRepo.createAccount({
      Username: username,
      Email: googleUser.email,
      PasswordHash: '', // Google accounts have no password
      RoleID: customerRole.RoleID,
      Avatar: googleUser.picture || '',
      Status: 'Active',
      Provider: 'google',
      ProviderAccountId: googleUser.googleId,
      EmailVerified: true,
      LastLogin: new Date(),
    });
    const phone = '00000000000';
    try {
      await this.authRepo.createCustomer({
        AccountID: newAccount.AccountID,
        FullName: googleUser.name,
        PhoneNumber: phone,
        Address: 'Default Address',
        PreferredPaymentMethod: 'Cash',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('CUSTOMER_PhoneNumber') || msg.includes('PhoneNumber')) {
        await this.authRepo.createCustomer({
          AccountID: newAccount.AccountID,
          FullName: googleUser.name,
          PhoneNumber: '00000000001',
          Address: 'Default Address',
          PreferredPaymentMethod: 'Cash',
        });
      } else {
        throw e;
      }
    }
    return newAccount;
  }

  async findOrCreateGoogleUser(googleUser: GoogleUserInfo) {
    const existing = await this.findGoogleUserByGoogleId(googleUser.googleId);
    if (existing) {
      await this.authRepo.updateAccountLastLogin(existing.AccountID);
      const updated = await this.authRepo.findAccountById(existing.AccountID, {
        withRole: true,
      });
      return updated ?? existing;
    }
    const byEmail = await this.findAccountByEmail(googleUser.email);
    if (byEmail) {
      return this.linkGoogleToExistingAccount(byEmail.AccountID, googleUser);
    }
    return this.createGoogleAccount(googleUser);
  }
}
