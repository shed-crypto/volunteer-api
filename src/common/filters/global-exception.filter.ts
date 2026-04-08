import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Глобальний фільтр виключень.
 * Уніфікує формат всіх помилок API.
 *
 * Формат відповіді:
 * {
 *   statusCode: 400,
 *   message: "Опис помилки",
 *   error: "Bad Request",
 *   path: "/api/requests",
 *   timestamp: "2024-01-01T00:00:00.000Z"
 * }
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Внутрішня помилка сервера';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = (res as any).message || message;
        error = (res as any).error || error;
      }

      error = exception.name;
    } else if (exception instanceof Error) {
      // Логуємо несподівані помилки з повним стектрейсом
      this.logger.error(
        `Unexpected error: ${exception.message}`,
        exception.stack,
      );

      // На production не розкриваємо деталі внутрішніх помилок
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
