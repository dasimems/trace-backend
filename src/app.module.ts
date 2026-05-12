import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import appConfig from './config/app.config';
import { validationSchema } from './config/validation.schema';
import { ResponseInterceptor } from '@common/response/response.interceptor';
import { AllExceptionsFilter } from '@common/exceptions/all-exceptions.filter';
import { AuthenticationModule } from '@common/authentication/authentication.module';
import { CacheModule } from '@common/cache/cache.module';
import { CloudinaryModule } from '@common/cloudinary/cloudinary.module';
import { EmailModule } from '@common/email/email.module';
import { EncryptionModule } from '@common/encryption/encryption.module';
import { JwtModule } from '@common/jwt/jwt.module';
import { OtpModule } from '@common/otp/otp.module';
import { PasswordModule } from '@common/password/password.module';
import { PinModule } from '@common/pin/pin.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { UrlModule } from '@common/url/url.module';

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
    AuthenticationModule,
    CacheModule,
    CloudinaryModule,
    EmailModule,
    EncryptionModule,
    JwtModule,
    OtpModule,
    PasswordModule,
    PinModule,
    PrismaModule,
    UrlModule,
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
