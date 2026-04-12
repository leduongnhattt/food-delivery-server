import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EnterpriseActivationService } from './enterprise-activation.service';

@Controller('enterprise/activation')
export class EnterpriseActivationController {
  constructor(private readonly activation: EnterpriseActivationService) {}

  @Get('verify-invite')
  verifyInvite(@Query('token') token: string) {
    return this.activation.verifyInvite(token);
  }

  @Get('track/email-open')
  async trackEmailOpen(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const buf = await this.activation.trackEmailOpenPixel(token);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }

  @Post('step1')
  step1(
    @Body()
    body: {
      token: string;
      enterpriseName: string;
      password: string;
      locale?: string;
    },
  ) {
    return this.activation.step1(body);
  }

  @Post('send-otp')
  sendOtp(@Body() body: { token: string }) {
    return this.activation.sendOtp(body);
  }

  @Post('verify-otp')
  verifyOtp(@Body() body: { token: string; otp: string }) {
    return this.activation.verifyOtp(body);
  }

  @Post('step3')
  step3(
    @Body()
    body: {
      token: string;
      address: string;
      latitude: number;
      longitude: number;
      openHours: string;
      closeHours: string;
      description?: string;
    },
  ) {
    return this.activation.step3(body);
  }
}

