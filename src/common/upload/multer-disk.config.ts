import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import fastifyMulter from 'fastify-multer';

/** Temp uploads live in project root / upload (cleaned on success/failure). */
const UPLOAD_DIR = path.join(process.cwd(), 'upload');

function ensureUploadDir(): string {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return UPLOAD_DIR;
}

/**
 * Disk storage for @nest-lab/fastify-multer (uses fastify-multer under the hood).
 * Files are written to ./upload in the project root for tracking and cleanup.
 */
export const multerDiskStorage = fastifyMulter.diskStorage({
  destination(_req, _file, cb) {
    cb(null, ensureUploadDir());
  },
  filename(_req, file, cb) {
    const safeName = path
      .basename(file.originalname || 'file')
      .replace(/[^a-zA-Z0-9.-]/g, '_');
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    cb(null, name);
  },
});
