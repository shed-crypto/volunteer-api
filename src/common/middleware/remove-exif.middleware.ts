
import sharp from 'sharp';
import { Request, Response, NextFunction } from 'express';

export const removeExifMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) return next();

  try {
    const inputBuffer = req.file.buffer || require('fs').readFileSync(req.file.path);
    const buffer = await sharp(inputBuffer)
      .rotate()
      .withMetadata({})
      .toBuffer();
    
    req.file.buffer = buffer;
    req.file.size = buffer.length;
    next();
  } catch (error) {
    console.error('EXIF removal failed:', error);
    next();
  }
};
