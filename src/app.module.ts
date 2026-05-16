import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import appConfig from './config/app.config';
import { validationSchema } from './config/validation.schema';
import { ResponseInterceptor } from '@common/response/response.interceptor';
import { AllExceptionsFilter } from '@common/exceptions/all-exceptions.filter';
import { LlmModule } from '@common/llm/llm.module';
import { AuthenticationModule } from '@common/authentication/authentication.module';
import { EventBusModule } from '@common/events/event-bus.module';
import { InsightsCommonModule } from '@common/insights/insights.module';
import { CacheModule } from '@common/cache/cache.module';
import { CloudinaryModule } from '@common/cloudinary/cloudinary.module';
import { EmailModule } from '@common/email/email.module';
import { EncryptionModule } from '@common/encryption/encryption.module';
import { JwtModule } from '@common/jwt/jwt.module';
import { OAuthModule } from '@common/oauth/oauth.module';
import { OtpModule } from '@common/otp/otp.module';
import { PasswordModule } from '@common/password/password.module';
import { PinModule } from '@common/pin/pin.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { SquadModule } from '@common/squad/squad.module';
import { UrlModule } from '@common/url/url.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AnalysisModule } from '@modules/analysis/analysis.module';
import { CopilotModule } from '@modules/copilot/copilot.module';
import { DevModule } from '@modules/dev/dev.module';
import { InvestmentsModule } from '@modules/investments/investments.module';
import { LoansModule } from '@modules/loans/loans.module';
import { OpportunitiesModule } from '@modules/opportunities/opportunities.module';
import { TransactionsModule } from '@modules/transactions/transactions.module';
import { UserModule } from '@modules/user/user.module';
import { WalletModule } from '@modules/wallet/wallet.module';
import { WebhooksModule } from '@modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      // Blocks app startup unless every required env key is present and well-formed.
      // See src/config/validation.schema.ts for the contract.
      validationSchema,
      envFilePath: '.env',
    }),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 10,
        },
      ],
    }),
    LlmModule,
    AuthenticationModule,
    CacheModule,
    EventBusModule,
    InsightsCommonModule,
    CloudinaryModule,
    EmailModule,
    EncryptionModule,
    JwtModule,
    OAuthModule,
    OtpModule,
    PasswordModule,
    PinModule,
    PrismaModule,
    SquadModule,
    UrlModule,

    AuthModule,
    UserModule,
    WalletModule,
    TransactionsModule,
    AnalysisModule,
    LoansModule,
    InvestmentsModule,
    OpportunitiesModule,
    CopilotModule,
    WebhooksModule,
    DevModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
