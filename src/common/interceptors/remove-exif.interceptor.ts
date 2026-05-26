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
 * Це INTERCEPTOR, а не middleware, тому що NestJS middleware
 * виконується ДО FileInterceptor, і req.file ще порожній.
 *
 * NOTE: sharp завантажується ліниво (lazy), оскільки на Alpine (Docker)
 * native модуль може бути відсутній — require('sharp') на рівні модуля
 * заблокував би реєстрацію всіх маршрутів, що використовують цей interceptor.
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
      if (file.mimetype.startsWith('image/')) {
        try {
          // Lazy-load sharp всередині методу (не на рівні модуля),
          // щоб уникнути збоїв реєстрації роутів на Alpine (Docker)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const sharp = require('sharp');
          
          // Ресайз до 400px + видалення EXIF
          const tempPath = file.path + '.tmp';
          await sharp(file.path)
            .rotate() // автоповорот за EXIF Orientation
            .resize(400, 400, { fit: 'cover', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .withMetadata({ exif: {} }) // видалити всі EXIF
            .toFile(tempPath);

          fs.unlinkSync(file.path);
          fs.renameSync(tempPath, file.path);
        } catch (err) {
          console.error('[RemoveExifInterceptor] sharp processing failed:', err);
          // Якщо sharp не вдалося — продовжуємо з оригінальним файлом
        }
      }
    }

    return next.handle();
  }
}
