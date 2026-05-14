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
  ): TransactionResponseDTO {
    return {
      id: tx.id,
      reference: tx.reference,
      providerReference: tx.providerReference || undefined,
      direction: tx.direction,
      status: tx.status,
      category: tx.category,
      description: tx.description || undefined,
      amount: tx.amount,
      fee: tx.fee,
      principalAmount: tx.principalAmount ?? undefined,
      settledAmount: tx.settledAmount ?? undefined,
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

  static createIndividualTransactionResponse(tx: TransactionDBDto) {
    return new TransactionResponse(this.constructTransactionDetails(tx));
  }

  static createMultipleTransactionResponse(
    transactions: TransactionDBDto[],
    paginationDetails: PaginationDetailsDTO,
  ) {
    return new TransactionResponse(
      transactions.map((tx) => this.constructTransactionDetails(tx)),
      paginationDetails,
    );
  }
}

export default TransactionResponse;
