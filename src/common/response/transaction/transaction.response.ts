import { PriceService } from '@common/price/price.service';
import { PaginationDetailsDTO } from '../base.dto';
import BaseResponse from '../base.response';
import { TransactionDBDto, TransactionResponseDTO } from './transaction.dto';

type ResponseType = TransactionResponseDTO | TransactionResponseDTO[];

class TransactionResponse extends BaseResponse<ResponseType> {
  constructor(data: ResponseType, paginationDetails?: PaginationDetailsDTO) {
    super(data, paginationDetails);
  }

  static constructTransactionDetails(
    tx: TransactionDBDto,
    priceService: PriceService,
  ): TransactionResponseDTO {
    const wrap = (kobo: number) =>
      priceService.constructPriceResponse(kobo, tx.currency);
    return {
      id: tx.id,
      reference: tx.reference,
      providerReference: tx.providerReference || undefined,
      direction: tx.direction,
      status: tx.status,
      category: tx.category,
      description: tx.description || undefined,
      amount: wrap(tx.amount),
      fee: wrap(tx.fee),
      principalAmount:
        tx.principalAmount === null || tx.principalAmount === undefined
          ? undefined
          : wrap(tx.principalAmount),
      settledAmount:
        tx.settledAmount === null || tx.settledAmount === undefined
          ? undefined
          : wrap(tx.settledAmount),
      currency: tx.currency,
      senderName: tx.senderName || undefined,
      senderAccountNumber: tx.senderAccountNumber || undefined,
      senderBankCode: tx.senderBankCode || undefined,
      senderBankName: tx.senderBankName || undefined,
      recipientName: tx.recipientName || undefined,
      recipientAccountNumber: tx.recipientAccountNumber || undefined,
      recipientBankCode: tx.recipientBankCode || undefined,
      recipientBankName: tx.recipientBankName || undefined,
      remark: tx.remark || undefined,
      provider: tx.provider,
      accountId: tx.accountId,
      processedAt: tx.processedAt || undefined,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    };
  }

  static createIndividualTransactionResponse(
    tx: TransactionDBDto,
    priceService: PriceService,
  ) {
    return new TransactionResponse(
      this.constructTransactionDetails(tx, priceService),
    );
  }

  static createMultipleTransactionResponse(
    transactions: TransactionDBDto[],
    paginationDetails: PaginationDetailsDTO,
    priceService: PriceService,
  ) {
    return new TransactionResponse(
      transactions.map((tx) =>
        this.constructTransactionDetails(tx, priceService),
      ),
      paginationDetails,
    );
  }
}

export default TransactionResponse;
