import { Module } from '@nestjs/common';
import { PocketService } from './pocket.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, PocketService],
})
export class WalletModule {}
