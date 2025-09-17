import { Request, Response, NextFunction } from 'express';
import winston from 'winston';

interface ApiKeyRequest extends Request {
  apiKey?: string;
  userId?: string;
}

const logger = winston.createLogger({
  defaultMeta: { service: 'AuthMiddleware' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/auth.log' })
  ]
});

export const apiKeyAuth = (req: ApiKeyRequest, res: Response, next: NextFunction): void => {
  try {
    const apiKey = req.header('X-API-Key') || req.header('Authorization')?.replace('Bearer ', '');
    
    if (!apiKey) {
      logger.warn('Missing API key', { ip: req.ip, path: req.path });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // API 키 검증
    const validApiKeys = process.env.API_KEYS?.split(',') || [];
    
    if (!validApiKeys.includes(apiKey)) {
      logger.error('Invalid API key attempt', { 
        apiKey: apiKey.substring(0, 8) + '***',
        ip: req.ip,
        path: req.path 
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // API 키를 기반으로 사용자 식별
    req.apiKey = apiKey;
    req.userId = `user_${Buffer.from(apiKey).toString('base64').substring(0, 8)}`;

    logger.info('API key authenticated', {
      userId: req.userId,
      path: req.path,
      method: req.method
    });

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed',
      timestamp: new Date().toISOString()
    });
  }
};

// 선택적 인증 미들웨어 (webhook 등에서 사용)
export const optionalAuth = (req: ApiKeyRequest, _res: Response, next: NextFunction): void => {
  const apiKey = req.header('X-API-Key') || req.header('Authorization')?.replace('Bearer ', '');
  
  if (apiKey) {
    const validApiKeys = process.env.API_KEYS?.split(',') || [];
    
    if (validApiKeys.includes(apiKey)) {
      req.apiKey = apiKey;
      req.userId = `user_${Buffer.from(apiKey).toString('base64').substring(0, 8)}`;
    }
  }
  
  next();
};
