import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { validate as isUUID } from 'uuid';

@Injectable()
export class UUIDGlobalParamPipe implements PipeTransform {
  private readonly paramKeysSet: Set<string>;

  constructor(paramKeys: string[] = ['id']) {
    this.paramKeysSet = new Set(paramKeys);
  }

  transform(value: any, metadata: ArgumentMetadata) {
    if (
      metadata.type === 'param' &&
      metadata.data &&
      this.paramKeysSet.has(metadata.data)
    ) {
      if (!isUUID(value)) {
        throw new BadRequestException(
          `Invalid UUID provided in parameter: ${metadata.data}`,
        );
      }
    }

    return value as unknown;
  }
}
