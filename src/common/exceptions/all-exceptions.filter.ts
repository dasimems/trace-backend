import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import BaseResponse from '@common/response/base.response';
import { CustomRequest } from '@common/authentication/authentication.dto';
import { File } from '@nest-lab/fastify-multer';
import * as fs from 'fs';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<
      CustomRequest & { file?: File; files?: File[] }
    >();

    // Clean up temp files from @nest-lab/fastify-multer disk storage
    const unlinkIfExists = (filepath: string) => {
      try {
        if (filepath && fs.existsSync(filepath)) {
          fs.unlink(filepath, () => {});
        }
      } catch (e) {
        console.error('Failed to cleanup uploaded file:', e);
      }
    };
    if (request?.file?.path) {
      unlinkIfExists(request.file.path);
    }
    if (request?.files) {
      try {
        if (Array.isArray(request.files)) {
          request.files.forEach(
            (file) => file?.path && unlinkIfExists(file.path),
          );
        } else if (typeof request.files === 'object') {
          (Object.values(request.files) as File[][])
            .flat()
            .forEach((file) => file?.path && unlinkIfExists(file.path));
        }
      } catch (cleanupError) {
        console.error('Failed to cleanup uploaded file:', cleanupError);
      }
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: any = BaseResponse.constructErrorResponse(
      'Internal server error',
    );

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      // If your ValidationPipe already built a BaseResponse error object, keep it
      if (
        typeof res === 'object' &&
        res !== null &&
        'message' in (res as any) &&
        'errors' in (res as any)
      ) {
        payload = res;
      } else {
        // Otherwise, wrap it in your format
        const message = (res as any).message || res;
        payload = BaseResponse.constructErrorResponse(message);
      }
    }

    response.code(status).send(payload);
  }
}
