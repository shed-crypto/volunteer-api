import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');

@Injectable()
export class RemoveExifMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.file && !(req.files && (req.files as any).length)) {
      return next();
    }

    const files = req.file
      ? [req.file]
      : (req.files as Express.Multer.File[]) || [];

    for (const file of files) {
      if (file.mimetype.startsWith('image/')) {
        const tempPath = file.path + '.tmp';
        await sharp(file.path)
          .rotate() // автоповорот за EXIF Orientation
          .withMetadata({ exif: {} }) // видалити всі EXIF
          .toFile(tempPath);

        fs.unlinkSync(file.path);
        fs.renameSync(tempPath, file.path);
      }
    }

    next();
  }
}