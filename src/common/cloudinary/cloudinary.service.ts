import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';
import {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
} from '../../shared/constants';
import * as fs from 'fs/promises';
import * as toStream from 'buffer-to-stream';
import { File } from '@nest-lab/fastify-multer';

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    const cloudinaryName = this.configService.get<string>(
      CLOUDINARY_CLOUD_NAME,
    );
    const cloudinaryApiKey = this.configService.get<string>(CLOUDINARY_API_KEY);
    const cloudinaryApiSecret = this.configService.get<string>(
      CLOUDINARY_API_SECRET,
    );
    cloudinary.config({
      cloud_name: cloudinaryName,
      api_key: cloudinaryApiKey,
      api_secret: cloudinaryApiSecret,
      secure: true,
    });
  }

  private getCloudinaryResourceType(
    mimetype: string,
  ): UploadApiOptions['resource_type'] {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    return 'raw';
  }

  async deleteFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch {
      throw new InternalServerErrorException(
        'Error encountered whilst trying to delete file!',
      );
    }
  }

  async uploadMultipleFiles(files: File[] | File | undefined, folder: string) {
    const fileList = Array.isArray(files) ? files : files ? [files] : [];
    const results = await Promise.allSettled(
      fileList.map((file) => this.uploadFile(file, folder)),
    );

    const successfulUploads = results
      .filter(
        (r): r is PromiseFulfilledResult<UploadApiResponse> =>
          r.status === 'fulfilled' && r.value != null,
      )
      .map((r) => r.value);

    const hasFailure = results.some((r) => r.status === 'rejected');

    if (hasFailure) {
      await Promise.allSettled(
        successfulUploads.map((file) => this.deleteFile(file.public_id)),
      );

      throw new InternalServerErrorException('Failed to upload all files');
    }

    return successfulUploads;
  }

  async uploadFile(file: File, folder: string) {
    const time = Date.now();

    const fileType = this.getCloudinaryResourceType(file.mimetype);
    const filePath = file.path;

    if (!filePath) {
      throw new InternalServerErrorException('File path not defined!');
    }

    const buffer: Buffer = await fs.readFile(filePath);

    return new Promise<UploadApiResponse | undefined>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: fileType,
          public_id: `${file?.originalname?.split('.')[0]}-${time}`,
        },
        async (error, result) => {
          if (error) {
            return reject(
              new Error(error?.message || 'Cloudinary upload failed'),
            );
          }
          if (file?.path) {
            try {
              await fs.unlink(file.path);
            } catch (unlinkErr) {
              console.warn(
                'Could not unlink temp file after upload:',
                file.path,
                unlinkErr,
              );
            }
          }
          return resolve(result);
        },
      );

      toStream(buffer).pipe(uploadStream);
    });
  }
}
