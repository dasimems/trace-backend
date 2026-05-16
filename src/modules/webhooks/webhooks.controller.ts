import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SquadPaymentWebhookPayload,
  SquadVirtualAccountWebhookPayload,
} from '@common/squad/squad.dto';
import { routes, subRoutes } from '@shared/variables';
import { WebhooksService } from './webhooks.service';

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

@ApiTags('Webhooks')
@Controller(routes.webhooks)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(subRoutes.squad)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Squad virtual account credit webhook',
    description:
      'Receives credit notifications from Squad. Verifies HMAC-SHA512 over the raw body, idempotently records a CREDIT transaction, and increments the recipient’s balance.',
  })
  async squad(
    @Req() req: RawBodyRequest,
    @Res() res: FastifyReply,
    @Body() body: SquadVirtualAccountWebhookPayload,
    @Headers('x-squad-encrypted-body') signatureA?: string,
    @Headers('x-squad-signature') signatureB?: string,
  ) {
    const signature = signatureA || signatureB;
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const result = await this.webhooksService.handleSquadVirtualAccountWebhook(
      rawBody,
      signature,
      body,
    );
    // Bypass the global response interceptor so Squad receives exactly the
    // shape it expects.
    return res.status(200).send(result);
  }

  @Post(`${subRoutes.squad}${subRoutes.payment}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Squad payment-gateway webhook (charge_successful etc.)',
    description:
      "Receives charge/payment notifications from Squad's payment gateway after a /wallet/fund checkout completes. Idempotent — calls the same finaliser the verify endpoint uses, so racing with verify is a no-op.",
  })
  async squadPayment(
    @Req() req: RawBodyRequest,
    @Res() res: FastifyReply,
    @Body() body: SquadPaymentWebhookPayload,
    @Headers('x-squad-encrypted-body') signatureA?: string,
    @Headers('x-squad-signature') signatureB?: string,
  ) {
    const signature = signatureA || signatureB;
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const result = await this.webhooksService.handleSquadPaymentWebhook(
      rawBody,
      signature,
      body,
    );
    return res.status(200).send(result);
  }
}
