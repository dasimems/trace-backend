import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Meta, Pagination } from './base.dto';

interface ApiResponseDataOptions {
  isArray?: boolean;
  description?: string;
}

const buildDataSchema = <TModel extends Type<unknown>>(
  model: TModel,
  isArray?: boolean,
) => {
  const dataSchema = isArray
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  const properties: Record<string, unknown> = { data: dataSchema };
  if (isArray) {
    properties.meta = { $ref: getSchemaPath(Meta) };
    properties.pagination = { $ref: getSchemaPath(Pagination) };
  }

  return { type: 'object' as const, properties };
};

export const ApiOkResponseData = <TModel extends Type<unknown>>(
  model: TModel,
  options: ApiResponseDataOptions = {},
) =>
  applyDecorators(
    ApiExtraModels(model, ...(options.isArray ? [Meta, Pagination] : [])),
    ApiOkResponse({
      description: options.description,
      schema: buildDataSchema(model, options.isArray),
    }),
  );

export const ApiCreatedResponseData = <TModel extends Type<unknown>>(
  model: TModel,
  options: ApiResponseDataOptions = {},
) =>
  applyDecorators(
    ApiExtraModels(model, ...(options.isArray ? [Meta, Pagination] : [])),
    ApiCreatedResponse({
      description: options.description,
      schema: buildDataSchema(model, options.isArray),
    }),
  );

export const ApiOkResponseMessage = (description?: string) =>
  ApiOkResponse({
    description,
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  });
