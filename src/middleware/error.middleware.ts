import { Request, Response, NextFunction } from 'express';
import winston from 'winston';
import { AxiosError } from 'axios';

interface ErrorRequest extends Request {
  id?: string;
  userId?: string;
}

interface CustomError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: any;
}

const logger = winston.createLogger({
  defaultMeta: { service: 'ErrorHandler' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  ]
});

export const errorHandler = (
  error: CustomError | AxiosError,
  req: ErrorRequest,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = req.id || 'unknown';
  const userId = req.userId || 'anonymous';
  const timestamp = new Date().toISOString();

  // 기본 에러 정보
  let status = 500;
  let message = 'Internal Server Error';
  let code = 'INTERNAL_ERROR';
  let details: any = undefined;

  // Axios 에러 처리
  if ('isAxiosError' in error && error.isAxiosError) {
    const axiosError = error as AxiosError;
    status = axiosError.response?.status || 502;
    message = (axiosError.response?.data as any)?.message || axiosError.message || 'External service error';
    code = 'EXTERNAL_SERVICE_ERROR';
    details = {
      url: axiosError.config?.url,
      method: axiosError.config?.method,
      status: axiosError.response?.status,
      data: axiosError.response?.data
    };
  }
  // 커스텀 에러 처리
  else if ('status' in error || 'statusCode' in error) {
    const customError = error as CustomError;
    status = customError.status || (customError as any).statusCode || 500;
    message = customError.message || 'Custom error occurred';
    code = customError.code || 'CUSTOM_ERROR';
    details = customError.details;
  }
  // 일반 에러 처리
  else {
    message = error.message || 'An unexpected error occurred';
    
    // 알려진 에러 타입별 처리
    if (error.name === 'ValidationError') {
      status = 400;
      code = 'VALIDATION_ERROR';
    } else if (error.name === 'UnauthorizedError') {
      status = 401;
      code = 'UNAUTHORIZED';
    } else if (error.name === 'ForbiddenError') {
      status = 403;
      code = 'FORBIDDEN';
    } else if (error.name === 'NotFoundError') {
      status = 404;
      code = 'NOT_FOUND';
    } else if (error.name === 'TimeoutError') {
      status = 408;
      code = 'TIMEOUT';
    } else if (error.name === 'ConflictError') {
      status = 409;
      code = 'CONFLICT';
    } else if (error.name === 'TooManyRequestsError') {
      status = 429;
      code = 'TOO_MANY_REQUESTS';
    } else if (error.name === 'ServiceUnavailableError') {
      status = 503;
      code = 'SERVICE_UNAVAILABLE';
    }
  }

  // 에러 로깅
  const logLevel = status >= 500 ? 'error' : 'warn';
  logger.log(logLevel, `[${requestId}] ${error.name || 'Error'}: ${message}`, {
    requestId,
    userId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    status,
    code,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    details: process.env.NODE_ENV === 'development' ? details : undefined,
    timestamp
  });

  // 응답 전송
  const response: any = {
    error: {
      code,
      message,
      requestId,
      timestamp
    }
  };

  // 개발 환경에서는 상세 정보 포함
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
    if (details) {
      response.error.details = details;
    }
  }

  res.status(status).json(response);
};

// 비동기 에러 처리를 위한 래퍼
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 사용자 정의 에러 클래스
export class ApiError extends Error {
  public status: number;
  public code: string;
  public details?: any;

  constructor(status: number, message: string, code?: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'API_ERROR';
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string = 'Bad Request', details?: any): ApiError {
    return new ApiError(400, message, 'BAD_REQUEST', details);
  }

  static unauthorized(message: string = 'Unauthorized', details?: any): ApiError {
    return new ApiError(401, message, 'UNAUTHORIZED', details);
  }

  static forbidden(message: string = 'Forbidden', details?: any): ApiError {
    return new ApiError(403, message, 'FORBIDDEN', details);
  }

  static notFound(message: string = 'Not Found', details?: any): ApiError {
    return new ApiError(404, message, 'NOT_FOUND', details);
  }

  static conflict(message: string = 'Conflict', details?: any): ApiError {
    return new ApiError(409, message, 'CONFLICT', details);
  }

  static tooManyRequests(message: string = 'Too Many Requests', details?: any): ApiError {
    return new ApiError(429, message, 'TOO_MANY_REQUESTS', details);
  }

  static internal(message: string = 'Internal Server Error', details?: any): ApiError {
    return new ApiError(500, message, 'INTERNAL_ERROR', details);
  }

  static serviceUnavailable(message: string = 'Service Unavailable', details?: any): ApiError {
    return new ApiError(503, message, 'SERVICE_UNAVAILABLE', details);
  }
}
