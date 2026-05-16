import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { SseAuthGuard } from '@common/authentication/sse-auth.guard';
import { EventBusService } from '@common/events/event-bus.service';
import {
  ApiCreatedResponseData,
  ApiOkResponseData,
} from '@common/response/api-response.decorator';
import { TransactionResponseDTO } from '@common/response/transaction/transaction.dto';
import { WalletPocketDTO } from '@common/response/wallet/pocket.dto';
import { VirtualCardDTO } from '@common/response/wallet/virtual-card.dto';
import {
  RecentRecipientDTO,
  TransferLookupResponseDTO,
  WalletResponseDTO,
} from '@common/response/wallet/wallet.dto';
import { routes, subRoutes } from '@shared/variables';
import {
  AllocateToPocketBodyDTO,
  CreatePocketBodyDTO,
  TransferBetweenPocketsBodyDTO,
  UpdatePocketBodyDTO,
} from './pocket.dto';
import { PocketService } from './pocket.service';
import { CreateVirtualCardBodyDTO } from './virtual-card.dto';
import { VirtualCardService } from './virtual-card.service';
import { LookupAccountBodyDTO, TransferBodyDTO } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallet')
@ApiBearerAuth('access-token')
@Controller(routes.wallet)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly pocketService: PocketService,
    private readonly virtualCardService: VirtualCardService,
    private readonly eventBus: EventBusService,
  ) {}

  // SSE — register BEFORE the class-level AuthGuard so SseAuthGuard runs
  // instead. Native browser EventSource cannot send custom headers, so this
  // accepts ?token=<jwt> in the query string as well.
  @UseGuards(SseAuthGuard)
  @Get(subRoutes.stream)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({
    summary: 'SSE stream of wallet events for the current user',
    description:
      'Server-Sent Events. Emits wallet-scoped events such as `wallet.credit.received` (incoming bank credits via Squad), `wallet.transfer.completed`, `wallet.transfer.failed`. Auth: `Authorization: Bearer <token>` header OR `?token=<token>` query (latter required for browser native EventSource).',
  })
  stream(@Req() req: CustomRequest, @Res() res: FastifyReply) {
    const auth = req.auth;
    if (!auth) {
      res.code(401).send({ message: 'Unauthorized!' });
      return;
    }
    const raw = res.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write(`: connected ${new Date().toISOString()}\n\n`);

    // Filter to wallet.* events so this stream stays focused. Other event
    // namespaces (analysis.*, loan.*, copilot.*) ride their own streams.
    const unsubscribe = this.eventBus.subscribe(auth.id, (event) => {
      if (!event.type.startsWith('wallet.')) return;
      try {
        raw.write(`event: ${event.type}\n`);
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client closed mid-write — cleanup runs on `close`.
      }
    });

    // Heartbeat — proxies routinely kill idle connections at 30–60s.
    const heartbeat = setInterval(() => {
      try {
        raw.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
  }

  // ─── All routes below require the standard Bearer-header AuthGuard. ──────
  // We can't put it at the class level because that would also run before
  // SseAuthGuard on the /stream route above and reject browser EventSource
  // requests (which can't set custom headers).

  @UseGuards(AuthGuard)
  @Get('/')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get wallet snapshot (account + balances)',
  })
  @ApiOkResponseData(WalletResponseDTO, {
    description: "Returns the user's primary bank account and balance figures.",
  })
  getWallet(@Req() req: CustomRequest) {
    return this.walletService.getWallet(req);
  }

  @UseGuards(AuthGuard)
  @Post(`${subRoutes.transfer}${subRoutes.lookup}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Look up a recipient by bank + account number',
    description:
      'Wraps Squad /payout/account/lookup. Run this before initiating a transfer.',
  })
  @ApiOkResponseData(TransferLookupResponseDTO, {
    description: 'Returns the verified account name.',
  })
  lookup(@Body() body: LookupAccountBodyDTO, @Req() req: CustomRequest) {
    return this.walletService.lookupAccount(body, req);
  }

  @UseGuards(AuthGuard)
  @Post(subRoutes.transfer)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Initiate an outbound transfer',
    description:
      'Holds the funds, calls Squad /payout/transfer, and records a DEBIT transaction. Returns the resulting transaction.',
  })
  @ApiCreatedResponseData(TransactionResponseDTO, {
    description: 'Returns the recorded DEBIT transaction.',
  })
  transfer(@Body() body: TransferBodyDTO, @Req() req: CustomRequest) {
    return this.walletService.transfer(body, req);
  }

  @UseGuards(AuthGuard)
  @Get(`${subRoutes.transfer}/:reference`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Re-query a transfer status',
    description:
      'Looks up local state; if still pending, calls Squad /payout/requery and resolves to SUCCESS/FAILED/REVERSED.',
  })
  @ApiOkResponseData(TransactionResponseDTO, {
    description: 'Returns the (possibly updated) transaction.',
  })
  requery(
    @Param('reference') reference: string,
    @Req() req: CustomRequest,
  ) {
    return this.walletService.requeryTransfer(reference, req);
  }

  @UseGuards(AuthGuard)
  @Get(subRoutes.recipients)
  @HttpCode(200)
  @ApiOperation({
    summary: 'List the user’s most recent unique recipients (up to 10)',
  })
  @ApiOkResponseData(RecentRecipientDTO, {
    isArray: true,
    description: 'Recent recipients.',
  })
  getRecentRecipients(@Req() req: CustomRequest) {
    return this.walletService.getRecentRecipients(req);
  }

  // ─── Pockets ───────────────────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get(subRoutes.pockets)
  @HttpCode(200)
  @ApiOperation({ summary: 'List the user’s wallet pockets (Spend / Save / Goals)' })
  @ApiOkResponseData(WalletPocketDTO, { isArray: true })
  listPockets(@Req() req: CustomRequest) {
    return this.pocketService.listPockets(req);
  }

  @UseGuards(AuthGuard)
  @Post(subRoutes.pockets)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new pocket' })
  @ApiCreatedResponseData(WalletPocketDTO)
  createPocket(
    @Body() body: CreatePocketBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.createPocket(body, req);
  }

  @UseGuards(AuthGuard)
  @Patch(`${subRoutes.pockets}/:id`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Rename a pocket or update its goal target' })
  @ApiOkResponseData(WalletPocketDTO)
  updatePocket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePocketBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.updatePocket(id, body, req);
  }

  @UseGuards(AuthGuard)
  @Delete(`${subRoutes.pockets}/:id`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Delete an empty pocket (default Spend pocket cannot be deleted)',
  })
  deletePocket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.deletePocket(id, req);
  }

  @UseGuards(AuthGuard)
  @Post(`${subRoutes.pockets}${subRoutes.transfer}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move funds between two pockets (accounting only, no Squad call)',
  })
  transferBetweenPockets(
    @Body() body: TransferBetweenPocketsBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.transferBetweenPockets(body, req);
  }

  @UseGuards(AuthGuard)
  @Post(`${subRoutes.pockets}/:id${subRoutes.allocate}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Allocate unallocated balance into a pocket',
    description:
      'Unallocated = account balance minus the sum of all pocket balances. This moves funds from that unallocated pool into the named pocket.',
  })
  allocateToPocket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AllocateToPocketBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.allocateToPocket(id, body, req);
  }

  @UseGuards(AuthGuard)
  @Post(`${subRoutes.pockets}/:id${subRoutes.withdraw}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Pull funds from a pocket back into unallocated' })
  withdrawFromPocket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AllocateToPocketBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.pocketService.withdrawFromPocket(id, body, req);
  }

  // ─── Virtual cards ─────────────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get(subRoutes.cards)
  @HttpCode(200)
  @ApiOperation({
    summary: 'List the user’s virtual cards',
    description:
      'Cards are not actually issued (no card-issuer integration). Returned values are persisted but the card numbers do not authorize real payments.',
  })
  @ApiOkResponseData(VirtualCardDTO, { isArray: true })
  listCards(@Req() req: CustomRequest) {
    return this.virtualCardService.list(req);
  }

  @UseGuards(AuthGuard)
  @Post(subRoutes.cards)
  @HttpCode(201)
  @ApiOperation({ summary: 'Mint a new virtual card' })
  @ApiCreatedResponseData(VirtualCardDTO)
  createCard(
    @Body() body: CreateVirtualCardBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.virtualCardService.create(body, req);
  }

  @UseGuards(AuthGuard)
  @Patch(`${subRoutes.cards}/:id${subRoutes.freeze}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Freeze an active card (status → FROZEN)' })
  @ApiOkResponseData(VirtualCardDTO)
  freezeCard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.virtualCardService.freeze(id, req);
  }

  @UseGuards(AuthGuard)
  @Patch(`${subRoutes.cards}/:id`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Unfreeze a card (status → ACTIVE)' })
  @ApiOkResponseData(VirtualCardDTO)
  unfreezeCard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.virtualCardService.unfreeze(id, req);
  }

  @UseGuards(AuthGuard)
  @Delete(`${subRoutes.cards}/:id`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Terminate a card (status → TERMINATED, hidden from list)',
  })
  terminateCard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.virtualCardService.terminate(id, req);
  }
}
