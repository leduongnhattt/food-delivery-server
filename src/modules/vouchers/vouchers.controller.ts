import { Controller, Get, Query } from '@nestjs/common';
import { VouchersService } from '@modules/vouchers/vouchers.service';

@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  /**
   * Compatibility endpoint with the legacy Next.js route:
   * - GET /vouchers?code=... -> { success: true, voucher } or 404-style payload
   * - GET /vouchers -> { success: true, vouchers: [...] }
   */
  @Get()
  async get(@Query('code') code?: string, @Query('limit') limitStr?: string) {
    if (code) {
      const voucher = await this.vouchersService.validate(code);
      if (!voucher) {
        return { success: false, error: 'Invalid voucher' };
      }
      return { success: true, voucher };
    }

    const limitParsed = limitStr != null ? parseInt(limitStr, 10) : NaN;
    const limit = Number.isNaN(limitParsed) ? 50 : limitParsed;
    const vouchers = await this.vouchersService.listApproved(limit);
    return { success: true, vouchers };
  }
}

