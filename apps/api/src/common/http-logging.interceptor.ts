import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const start = Date.now();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const requestId =
      // set by main.ts middleware; fall back to header if present
      (req as any).requestId ||
      String(req.headers['x-request-id'] ?? '').trim() ||
      undefined;

    return next.handle().pipe(
      catchError((err) => {
        // Let Nest handle the actual response; we just want visibility.
        throw err;
      }),
      finalize(() => {
        const ms = Date.now() - start;
        const statusCode = res.statusCode;
        const rid = requestId ? ` rid=${requestId}` : '';
        this.logger.log(`${method} ${url} -> ${statusCode} (${ms}ms)${rid}`);
      }),
    );
  }
}


