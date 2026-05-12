import BaseResponse from '@common/response/base.response';
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Injectable()
export class ValidationPipe implements PipeTransform {
  constructor() {}

  async transform(value: unknown, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }
    if (!value) {
      throw new BadRequestException('No data provided');
    }

    const object = plainToInstance(metatype as new () => object, value, {
      enableImplicitConversion: true,
    });
    const errors = await validate(object || {}, {
      whitelist: true,
      forbidNonWhitelisted: true,
      skipMissingProperties: false,
    });

    if (Array.isArray(errors) && errors.length > 0) {
      const formattedErrors = errors.reduce(
        (acc, error) => {
          if (error.children && error.children.length > 0) {
            error.children.forEach((child) => {
              acc[child.property] =
                Object.values(child.constraints ?? {})[0] ?? 'Validation error';
            });
          } else {
            acc[error.property] =
              Object.values(error.constraints ?? {})[0] ?? 'Validation error';
          }
          return acc;
        },
        {} as Record<string, string>,
      );

      throw new BadRequestException(
        BaseResponse.constructErrorResponse(
          'Invalid fields detected',
          formattedErrors,
        ),
      );
    }

    return object;
  }

  private toValidate(metatype: any): boolean {
    const types: any[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
