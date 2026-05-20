import { PriceService } from '@common/price/price.service';
import BaseResponse from '../base.response';
import { BankAccountDBDto, BankAccountResponseDTO } from './account.dto';

type ResponseType = BankAccountResponseDTO | BankAccountResponseDTO[];

class AccountResponse extends BaseResponse<ResponseType> {
  constructor(data: ResponseType) {
    super(data);
  }

  static constructAccountDetails(
    account: BankAccountDBDto,
    priceService: PriceService,
  ): BankAccountResponseDTO {
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankCode: account.bankCode,
      customerIdentifier: account.customerIdentifier,
      beneficiaryAccount: account.beneficiaryAccount || undefined,
      provider: account.provider,
      balance: priceService.constructPriceResponse(account.balance),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  static createIndividualAccountResponse(
    account: BankAccountDBDto,
    priceService: PriceService,
  ) {
    return new AccountResponse(
      this.constructAccountDetails(account, priceService),
    );
  }

  static createMultipleAccountResponse(
    accounts: BankAccountDBDto[],
    priceService: PriceService,
  ) {
    return new AccountResponse(
      accounts.map((account) =>
        this.constructAccountDetails(account, priceService),
      ),
    );
  }
}

export default AccountResponse;
