import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { File } from '@nest-lab/fastify-multer';

/** Accept multer file objects (disk: path; memory: buffer). Don't require fieldname so disk-stored files are always accepted. */
function isFileLike(value: unknown): value is File {
  if (value == null || typeof value !== 'object') return false;
  const f = value as File;
  return f.path != null || f.buffer != null;
}

function toFileList(value: File[] | File | undefined): File[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter(isFileLike);
  return isFileLike(value) ? [value] : [];
}

@Injectable()
export class RequireFilesPipe
  implements PipeTransform<File[] | File | undefined, File[]>
{
  constructor(
    private readonly requireAtLeastOne = true,
    private readonly message = 'Please select at least one file.',
  ) {}

  transform(value: File[] | File | undefined): File[] {
    const files = toFileList(value);
    if (this.requireAtLeastOne && files.length === 0) {
      throw new BadRequestException(this.message);
    }
    return files;
  }
}

@Injectable()
export class OptionalFilesPipe
  implements PipeTransform<File[] | File | undefined, File[]>
{
  transform(value: File[] | File | undefined): File[] {
    return toFileList(value);
  }
}
