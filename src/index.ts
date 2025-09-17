import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import winston from 'winston';
import { createServer } from 'http';
import { fabricRouter } from './routes/fabric.routes';
import { webhookRouter } from './routes/webhook.routes';
import { errorHandler } from './middleware/error.middleware';
import { rateLimiter } from './middleware/rateLimit.middleware';
import { apiKeyAuth } from './middleware/auth.middleware';
import { RedisClient } from './services/redis.service';
import { FabricService } from './services/fabric.service';

// 환경 변수 로드
dotenv.config();

// Logger 설정
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.colorize()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Express 앱 초기화
const app: Express = express();
const PORT = process.env.PORT || 3000;

// 전역 미들웨어 설정
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request ID 생성 미들웨어
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).id = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  logger.info(`[${(req as any).id}] ${req.method} ${req.path}`, {
    headers: req.headers,
    body: req.body,
    query: req.query
  });
  next();
});

// 헬스체크 엔드포인트
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API 버전 정보
app.get('/api/v1', (_req: Request, res: Response) => {
  res.status(200).json({
    version: '1.0.0',
    description: 'INJE Private Blockchain API Gateway',
    endpoints: {
      transactions: '/api/v1/transactions',
      status: '/api/v1/transactions/:txId/status',
      health: '/health'
    }
  });
});

// API 라우터 등록
app.use('/api/v1/transactions', rateLimiter, apiKeyAuth, fabricRouter);
app.use('/api/v1/webhooks', webhookRouter);

// 404 핸들러
app.use((req: Request, res: Response) => {
  logger.warn(`404 - Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

// 전역 에러 핸들러
app.use(errorHandler);

// 서버 시작
async function startServer() {
  try {
    // Redis 연결
    await RedisClient.getInstance().connect();
    logger.info('Redis connected successfully');

    // Fabric 네트워크 연결
    await FabricService.getInstance().initialize();
    logger.info('Fabric network connected successfully');

    // HTTP 서버 시작
    const server = createServer(app);

    server.listen(PORT, () => {
      logger.info(`🚀 INJE API Gateway running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`API Documentation: http://localhost:${PORT}/api/v1`);
    });

    // Graceful Shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        await RedisClient.getInstance().disconnect();
        await FabricService.getInstance().disconnect();
        logger.info('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// TypeScript 타입 확장
declare global {
  namespace Express {
    interface Request {
      id?: string;
      userId?: string;
      apiKey?: string;
    }
  }
}

// 서버 시작
startServer();