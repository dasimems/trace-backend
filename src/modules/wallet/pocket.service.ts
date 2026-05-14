import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { WalletPocketSelect } from '@common/prisma/selects/wallet-pocket.select';
import BaseResponse from '@common/response/base.response';
import {
  AllocateToPocketBodyDTO,
  CreatePocketBodyDTO,
  TransferBetweenPocketsBodyDTO,
  UpdatePocketBodyDTO,
} from './pocket.dto';

@Injectable()
export class PocketService {
  constructor(private readonly prismaService: PrismaService) {}

  private requireAuth(req: CustomRequest) {
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException('Unauthorized!');
    return auth;
  }

  private async getPrimaryAccount(userId: string) {
    return this.prismaService.bankAccounts.findFirst({
      where: { userId },
      select: { id: true, balance: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listPockets(req: CustomRequest) {
    const auth = this.requireAuth(req);
    const pockets = await this.prismaService.walletPockets.findMany({
      where: { userId: auth.id },
      select: WalletPocketSelect,
      orderBy: { createdAt: 'asc' },
    });
    return new BaseResponse(pockets);
  }

  async createPocket(body: CreatePocketBodyDTO, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const account = await this.getPrimaryAccount(auth.id);
    if (!account) {
      throw new NotFoundException(
        'No bank account found — complete sign-up first.',
      );
    }

    const created = await this.prismaService.walletPockets.create({
      data: {
        name: body.name,
        type: body.type,
        targetAmount: body.targetAmount ?? null,
        accountId: account.id,
        userId: auth.id,
      },
      select: WalletPocketSelect,
    });
    return new BaseResponse(created);
  }

  async updatePocket(
    id: string,
    body: UpdatePocketBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const pocket = await this.prismaService.walletPockets.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!pocket || pocket.userId !== auth.id) {
      throw new NotFoundException('Pocket not found.');
    }
    if (Object.keys(body).length === 0) {
      throw new BadRequestException('No updatable fields provided.');
    }

    const updated = await this.prismaService.walletPockets.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.targetAmount !== undefined
          ? { targetAmount: body.targetAmount }
          : {}),
      },
      select: WalletPocketSelect,
    });
    return new BaseResponse(updated);
  }

  async deletePocket(id: string, req: CustomRequest) {
    const auth = this.requireAuth(req);
    const pocket = await this.prismaService.walletPockets.findUnique({
      where: { id },
      select: { id: true, userId: true, balance: true, isDefault: true },
    });
    if (!pocket || pocket.userId !== auth.id) {
      throw new NotFoundException('Pocket not found.');
    }
    if (pocket.isDefault) {
      throw new ForbiddenException('The default Spend pocket cannot be deleted.');
    }
    if (pocket.balance > 0) {
      throw new BadRequestException(
        'Move the funds out of this pocket before deleting it.',
      );
    }
    await this.prismaService.walletPockets.delete({ where: { id } });
    return new BaseResponse('Pocket deleted.');
  }

  // Moves funds between two pockets owned by the same user. Pure accounting:
  // doesn't touch Squad. The pockets must belong to the same bank account.
  async transferBetweenPockets(
    body: TransferBetweenPocketsBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    if (body.fromPocketId === body.toPocketId) {
      throw new BadRequestException(
        'Source and destination pockets must differ.',
      );
    }

    const [from, to] = await Promise.all([
      this.prismaService.walletPockets.findUnique({
        where: { id: body.fromPocketId },
        select: { id: true, userId: true, balance: true, accountId: true },
      }),
      this.prismaService.walletPockets.findUnique({
        where: { id: body.toPocketId },
        select: { id: true, userId: true, accountId: true },
      }),
    ]);

    if (
      !from ||
      !to ||
      from.userId !== auth.id ||
      to.userId !== auth.id
    ) {
      throw new NotFoundException('Pocket not found.');
    }
    if (from.accountId !== to.accountId) {
      throw new BadRequestException(
        'Pockets must belong to the same account.',
      );
    }
    if (from.balance < body.amount) {
      throw new BadRequestException(
        'Insufficient balance in the source pocket.',
      );
    }

    const [updatedFrom, updatedTo] = await this.prismaService.$transaction([
      this.prismaService.walletPockets.update({
        where: { id: from.id },
        data: { balance: { decrement: body.amount } },
        select: WalletPocketSelect,
      }),
      this.prismaService.walletPockets.update({
        where: { id: to.id },
        data: { balance: { increment: body.amount } },
        select: WalletPocketSelect,
      }),
    ]);
    return new BaseResponse({ from: updatedFrom, to: updatedTo });
  }

  // Moves funds from the unallocated portion of the bank balance into a
  // pocket. "Unallocated" = account.balance - sum(pocket.balance).
  async allocateToPocket(
    pocketId: string,
    body: AllocateToPocketBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const pocket = await this.prismaService.walletPockets.findUnique({
      where: { id: pocketId },
      select: { id: true, userId: true, accountId: true },
    });
    if (!pocket || pocket.userId !== auth.id) {
      throw new NotFoundException('Pocket not found.');
    }

    const account = await this.prismaService.bankAccounts.findUnique({
      where: { id: pocket.accountId },
      select: { id: true, balance: true },
    });
    if (!account) throw new NotFoundException('Account not found.');

    const totalAllocated = await this.prismaService.walletPockets.aggregate({
      where: { accountId: account.id },
      _sum: { balance: true },
    });
    const unallocated = account.balance - (totalAllocated._sum.balance ?? 0);
    if (unallocated < body.amount) {
      throw new ConflictException(
        `Only ₦${Math.round(unallocated / 100).toLocaleString('en-NG')} is unallocated and available to move.`,
      );
    }

    const updated = await this.prismaService.walletPockets.update({
      where: { id: pocket.id },
      data: { balance: { increment: body.amount } },
      select: WalletPocketSelect,
    });
    return new BaseResponse(updated);
  }

  // Pull from a pocket back into the unallocated balance.
  async withdrawFromPocket(
    pocketId: string,
    body: AllocateToPocketBodyDTO,
    req: CustomRequest,
  ) {
    const auth = this.requireAuth(req);
    const pocket = await this.prismaService.walletPockets.findUnique({
      where: { id: pocketId },
      select: { id: true, userId: true, balance: true },
    });
    if (!pocket || pocket.userId !== auth.id) {
      throw new NotFoundException('Pocket not found.');
    }
    if (pocket.balance < body.amount) {
      throw new BadRequestException(
        'Insufficient balance in this pocket.',
      );
    }
    const updated = await this.prismaService.walletPockets.update({
      where: { id: pocket.id },
      data: { balance: { decrement: body.amount } },
      select: WalletPocketSelect,
    });
    return new BaseResponse(updated);
  }
}
