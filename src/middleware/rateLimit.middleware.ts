import { Request, Response, NextFunction } from 'express';
import { RedisClient } from '../services/redis.service';
import winston from 'winston';

interface RateLimitRequest extends Request {
  userId?: string;
  apiKey?: string;
}

const logger = winston.createLogger({
  defaultMeta: { service: 'RateLimitMiddleware' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/ratelimit.log' })
  ]
});

const redis = RedisClient.getInstance();

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: RateLimitRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export const createRateLimit = (options: RateLimitOptions) => {
  const {
    windowMs,
    maxRequests,
    keyGenerator = (req) => req.userId || req.ip || 'unknown'
  } = options;

  return async (req: Request & RateLimitRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `ratelimit:${keyGenerator(req)}`;
      const windowSeconds = Math.floor(windowMs / 1000);

      const allowed = await redis.checkRateLimit(key, maxRequests, windowSeconds);

      if (!allowed) {
        const resetTime = new Date(Date.now() + windowMs);
        
        logger.warn('Rate limit exceeded', {
          key: keyGenerator(req),
          ip: req.ip,
          path: req.path,
          method: req.method,
          resetTime: resetTime.toISOString()
        });

        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: Math.ceil(windowMs / 1000),
          resetTime: resetTime.toISOString(),
          timestamp: new Date().toISOString()
        });
        return;
      }

      // 성공 시 헤더 추가
      const currentCount = await redis.get(key);
      const remaining = Math.max(0, maxRequests - parseInt(currentCount || '0'));
      const resetTime = new Date(Date.now() + windowMs);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime.getTime() / 1000));
      res.setHeader('X-RateLimit-Window', windowMs);

      // 로깅
      logger.debug('Rate limit check passed', {
        key: keyGenerator(req),
        remaining,
        limit: maxRequests
      });

      next();
    } catch (error) {
      logger.error('Rate limit middleware error:', error);
      // 에러 시 요청 통과 시킴
      next();
    }
  };
};

// 기본 rate limiter (환경변수에서 설정값 사용)
export const rateLimiter = createRateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1분
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'), // 100요청/분
  keyGenerator: (req) => {
    // API 키가 있으면 사용자 기준, 없으면 IP 기준
    return req.userId || `ip:${req.ip || 'unknown'}`;
  }
});

// 엄격한 rate limiter (로그인, 중요 API 용)
export const strictRateLimiter = createRateLimit({
  windowMs: 60000, // 1분
  maxRequests: 10,  // 10요청/분
  keyGenerator: (req) => req.userId || `ip:${req.ip || 'unknown'}`
});

// 느슨한 rate limiter (공개 API 용)
export const publicRateLimiter = createRateLimit({
  windowMs: 60000,  // 1분
  maxRequests: 1000, // 1000요청/분
  keyGenerator: (req) => `ip:${req.ip || 'unknown'}`
});
