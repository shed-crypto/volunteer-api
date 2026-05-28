import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as fs from 'fs';

/**
 * RemoveExifInterceptor
 *
 * Видаляє EXIF-дані з усіх завантажених зображень після того,
 * як FileInterceptor (multer) зберіг файл на диск.
 *
 * Для JPEG — конвертує з якістю 80% та ресайзом до 400px.
 * Для PNG/GIF/WEBP — тільки видаляє EXIF, зберігаючи оригінальний формат.
 * Відео та інші файли — пропускає.
 */
@Injectable()
export class RemoveExifInterceptor implements NestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const files: Express.Multer.File[] = [];

    if (req.file) {
      files.push(req.file);
    } else if (req.files && Array.isArray(req.files)) {
      files.push(...(req.files as Express.Multer.File[]));
    }

    for (const file of files) {
      if (!file.mimetype.startsWith('image/')) continue;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sharp = require('sharp');

        const tempPath = file.path + '.tmp';

        if (file.mimetype === 'image/jpeg') {
          // JPEG: ресайз до 400px + видалення EXIF
          await sharp(file.path)
            .rotate() // автоповорот за EXIF Orientation
            .resize(400, 400, { fit: 'cover', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .withMetadata({ exif: {} })
            .toFile(tempPath);
        } else {
          // PNG, GIF, WEBP, HEIC: тільки видалення EXIF без зміни формату
          await sharp(file.path)
            .rotate()
            .resize(400, 400, { fit: 'cover', withoutEnlargement: true })
            .withMetadata({ exif: {} })
            .toFile(tempPath);
        }

        fs.unlinkSync(file.path);
        fs.renameSync(tempPath, file.path);
      } catch (err) {
        console.error('[RemoveExifInterceptor] sharp processing failed:', err);
        // Якщо sharp не вдалося — продовжуємо з оригінальним файлом
      }
    }

    return next.handle();
  }
}