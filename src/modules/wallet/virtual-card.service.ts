import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  VirtualCardBrandEnum,
  VirtualCardStatusEnum,
} from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import BaseResponse from '@common/response/base.response';
import { VirtualCardDTO } from '@common/response/wallet/virtual-card.dto';
import { CreateVirtualCardBodyDTO } from './virtual-card.dto';

const DEFAULT_SPEND_LIMIT_KOBO = 200_000 * 100; // ₦200,000

// Cards aren't actually issued — Squad doesn't have a card-issuing API in
// our stack. We synthesize plausible card data so the wallet UI has
// something to render. Status transitions + spend-limit changes ARE real
// (the row persists), but the card number itself doesn't authorize any
// real payment.
@Injectable()
export class VirtualCardService {
  constructor(private readonly prismaService: PrismaService) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  async list(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const cards = await this.prismaService.virtualCards.findMany({
      where: { userId: auth.id, status: { not: 'TERMINATED' } },
      orderBy: { createdAt: 'asc' },
    });
    return new BaseResponse(cards.map((c) => this.toDTO(c)));
  }

  async create(body: CreateVirtualCardBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const account = await this.prismaService.bankAccounts.findFirst({
      where: { userId: auth.id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!account) {
      throw new NotFoundException(
        'No bank account found — complete sign-up Stage 2 first.',
      );
    }

    const card = await this.prismaService.virtualCards.create({
      data: {
        userId: auth.id,
        accountId: account.id,
        last4: this.randomLast4(),
        brand: body.brand ?? VirtualCardBrandEnum.VERVE,
        expMonth: 1 + Math.floor(Math.random() * 12),
        expYear: new Date().getFullYear() + 4,
        status: VirtualCardStatusEnum.ACTIVE,
        spendLimitMonthly: body.spendLimitMonthly ?? DEFAULT_SPEND_LIMIT_KOBO,
        spentThisMonth: 0,
      },
    });
    return new BaseResponse(this.toDTO(card));
  }

  async freeze(id: string, req: CustomRequest) {
    return this.setStatus(id, VirtualCardStatusEnum.FROZEN, req);
  }

  async unfreeze(id: string, req: CustomRequest) {
    return this.setStatus(id, VirtualCardStatusEnum.ACTIVE, req);
  }

  async terminate(id: string, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const card = await this.prismaService.virtualCards.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!card || card.userId !== auth.id) {
      throw new NotFoundException('Card not found.');
    }
    if (card.status === VirtualCardStatusEnum.TERMINATED) {
      return new BaseResponse('Card was already terminated.');
    }
    await this.prismaService.virtualCards.update({
      where: { id },
      data: { status: VirtualCardStatusEnum.TERMINATED },
    });
    return new BaseResponse('Card terminated.');
  }

  private async setStatus(
    id: string,
    status: VirtualCardStatusEnum,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const card = await this.prismaService.virtualCards.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!card || card.userId !== auth.id) {
      throw new NotFoundException('Card not found.');
    }
    if (card.status === VirtualCardStatusEnum.TERMINATED) {
      throw new NotFoundException('Card has been terminated.');
    }
    const updated = await this.prismaService.virtualCards.update({
      where: { id },
      data: { status },
    });
    return new BaseResponse(this.toDTO(updated));
  }

  private toDTO(card: {
    id: string;
    last4: string;
    brand: VirtualCardBrandEnum;
    expMonth: number;
    expYear: number;
    status: VirtualCardStatusEnum;
    spendLimitMonthly: number;
    spentThisMonth: number;
    createdAt: Date;
  }): VirtualCardDTO {
    return {
      id: card.id,
      last4: card.last4,
      brand: card.brand,
      expMonth: card.expMonth,
      expYear: card.expYear,
      status: card.status,
      spendLimitMonthly: card.spendLimitMonthly,
      spentThisMonth: card.spentThisMonth,
      createdAt: card.createdAt,
    };
  }

  private randomLast4(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }
}
