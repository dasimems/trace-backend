import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { CORS_ORIGINS } from '@shared/constants';

export function IsAllowedOrigin(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAllowedOrigin',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;

          const allowedOrigins = (process.env[CORS_ORIGINS] || '')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);

          if (allowedOrigins.length === 0) return true;

          try {
            const parsed = new URL(value);
            return allowedOrigins.some((origin) => {
              try {
                const allowed = new URL(origin);
                return parsed.origin === allowed.origin;
              } catch {
                return parsed.origin === origin;
              }
            });
          } catch {
            return false;
          }
        },

        defaultMessage(args: ValidationArguments) {
          return `${args.property} must belong to an allowed domain`;
        },
      },
    });
  };
}
