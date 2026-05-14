import BaseResponse from '../base.response';
import { BankAccountDBDto, BankAccountResponseDTO } from './account.dto';

type ResponseType = BankAccountResponseDTO | BankAccountResponseDTO[];

class AccountResponse extends BaseResponse<ResponseType> {
  constructor(data: ResponseType) {
    super(data);
  }

  static constructAccountDetails(
    account: BankAccountDBDto,
  ): BankAccountResponseDTO {
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankCode: account.bankCode,
      customerIdentifier: account.customerIdentifier,
      beneficiaryAccount: account.beneficiaryAccount || undefined,
      provider: account.provider,
      balance: account.balance,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  static createIndividualAccountResponse(account: BankAccountDBDto) {
    return new AccountResponse(this.constructAccountDetails(account));
  }

  static createMultipleAccountResponse(accounts: BankAccountDBDto[]) {
    return new AccountResponse(
      accounts.map((account) => this.constructAccountDetails(account)),
    );
  }
}

export default AccountResponse;
