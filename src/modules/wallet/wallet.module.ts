import { Module } from '@nestjs/common';
import { PaymentRequestsService } from './payment-requests.service';
import { PocketService } from './pocket.service';
import { VirtualCardService } from './virtual-card.service';
import { WalletController } from './wallet.controller';
import { WalletReconcilerService } from './wallet-reconciler.service';
import { WalletService } from './wallet.service';

@Module({
  controllers: [WalletController],
  providers: [
    WalletService,
    PocketService,
    VirtualCardService,
    PaymentRequestsService,
    WalletReconcilerService,
  ],
  // Webhook handler reuses `PaymentRequestsService.finaliseAsPaid` and
  // `WalletService.finaliseFundedTransaction` to keep the verify-on-return
  // and webhook paths idempotent against each other.
  exports: [WalletService, PaymentRequestsService],
})
export class WalletModule {}
