import { Router, Request, Response } from 'express';
import { WebhookService } from '../services/webhook.service';
import { RedisClient } from '../services/redis.service';
import { asyncHandler, ApiError } from '../middleware/error.middleware';
import { optionalAuth } from '../middleware/auth.middleware';
import { publicRateLimiter } from '../middleware/rateLimit.middleware';
import winston from 'winston';
import * as crypto from 'crypto';

interface AuthenticatedRequest extends Request {
  userId?: string;
  apiKey?: string;
  id?: string;
}

const router = Router();
const webhookService = WebhookService.getInstance();
const redis = RedisClient.getInstance();

const logger = winston.createLogger({
  defaultMeta: { service: 'WebhookRoutes' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/webhook.log' })
  ]
});

// 웹훅 서비스 상태 조회
router.get('/status', optionalAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const requestId = req.id || 'unknown';

  try {
    const stats = await webhookService.getStats();
    
    logger.debug(`Webhook service stats retrieved`, {
      requestId,
      stats
    });

    res.status(200).json({
      success: true,
      data: {
        service: 'webhook',
        ...stats,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to get webhook service stats:', error);
    throw ApiError.internal('Failed to retrieve webhook service status');
  }
}));

// Dead Letter Queue 재처리
router.post('/dlq/reprocess', optionalAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const requestId = req.id || 'unknown';
  const userId = req.userId || 'system';

  try {
    const reprocessedCount = await webhookService.reprocessDLQ();
    
    logger.info(`DLQ reprocessing initiated`, {
      requestId,
      reprocessedCount,
      userId
    });

    res.status(200).json({
      success: true,
      message: 'Dead Letter Queue reprocessing initiated',
      data: {
        reprocessedJobs: reprocessedCount,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to reprocess DLQ:', error);
    throw ApiError.internal('Failed to reprocess Dead Letter Queue');
  }
}));

// DLQ 내용 조회
router.get('/dlq', optionalAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { limit = '10', offset = '0' } = req.query;
  const requestId = req.id || 'unknown';

  try {
    const limitNum = Math.min(parseInt(limit as string), 100); // 최대 100개
    const offsetNum = parseInt(offset as string);

    // DLQ 내용 조회
    const dlqJobs = await redis.lrange('webhook:dlq', offsetNum, offsetNum + limitNum - 1);
    const totalCount = await redis.llen('webhook:dlq');

    const jobs = dlqJobs.map(jobData => {
      const job = JSON.parse(jobData);
      return {
        id: job.id,
        correlationId: job.payload.correlationId,
        callbackUrl: job.callbackUrl,
        attempts: job.attempts,
        lastError: job.lastError,
        movedToDLQ: job.movedToDLQ
      };
    });

    logger.debug(`Retrieved ${jobs.length} DLQ jobs`, {
      requestId,
      total: totalCount,
      limit: limitNum,
      offset: offsetNum
    });

    res.status(200).json({
      success: true,
      data: {
        jobs,
        pagination: {
          total: totalCount,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < totalCount
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to retrieve DLQ contents:', error);
    throw ApiError.internal('Failed to retrieve Dead Letter Queue contents');
  }
}));

// 특정 작업 재시도
router.post('/retry/:jobId', optionalAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { jobId } = req.params;
  const requestId = req.id || 'unknown';
  const userId = req.userId || 'system';

  if (!jobId) {
    throw ApiError.badRequest('Missing jobId parameter');
  }

  try {
    // DLQ에서 해당 작업 찾기
    const dlqJobs = await redis.lrange('webhook:dlq', 0, -1);
    
    let targetJob = null;
    let targetIndex = -1;

    for (let i = 0; i < dlqJobs.length; i++) {
      const job = JSON.parse(dlqJobs[i]);
      if (job.id === jobId) {
        targetJob = job;
        targetIndex = i;
        break;
      }
    }

    if (!targetJob) {
      throw ApiError.notFound(`Job not found in DLQ: ${jobId}`);
    }

    // DLQ에서 제거
    // Redis LREM: 리스트에서 특정 값 제거
    await redis.lrem('webhook:dlq', 1, dlqJobs[targetIndex]);

    // 재시도 카운트 리셋 및 대기열에 추가
    targetJob.attempts = 0;
    delete targetJob.movedToDLQ;
    delete targetJob.lastError;

    await redis.lpush('webhook:queue', JSON.stringify(targetJob));

    logger.info(`Job retry initiated from DLQ`, {
      requestId,
      jobId,
      correlationId: targetJob.payload.correlationId,
      userId
    });

    res.status(200).json({
      success: true,
      message: 'Job retry initiated from Dead Letter Queue',
      data: {
        jobId,
        correlationId: targetJob.payload.correlationId,
        retryAt: new Date().toISOString()
      }
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to retry job ${jobId}:`, error);
    throw ApiError.internal('Failed to retry webhook job');
  }
}));

// 웹훅 전송 히스토리 조회
router.get('/history/:correlationId', optionalAuth, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { correlationId } = req.params;

  if (!correlationId) {
    throw ApiError.badRequest('Missing correlationId parameter');
  }

  try {
    // 성공 히스토리 조회
    const successData = await redis.get(`webhook:success:${correlationId}`);
    
    if (successData) {
      const history = JSON.parse(successData);
      
      res.status(200).json({
        success: true,
        data: {
          correlationId,
          status: 'SUCCESS',
          ...history,
          retrievedAt: new Date().toISOString()
        }
      });
      return;
    }

    // 실패 히스토리 조회 (DLQ에서 찾기)
    const dlqJobs = await redis.lrange('webhook:dlq', 0, -1);
    const failedJob = dlqJobs.find(jobData => {
      const job = JSON.parse(jobData);
      return job.payload.correlationId === correlationId;
    });

    if (failedJob) {
      const job = JSON.parse(failedJob);
      
      res.status(200).json({
        success: true,
        data: {
          correlationId,
          status: 'FAILED',
          attempts: job.attempts,
          lastError: job.lastError,
          movedToDLQ: job.movedToDLQ,
          callbackUrl: job.callbackUrl,
          retrievedAt: new Date().toISOString()
        }
      });
      return;
    }

    // 대기 중인 작업 확인
    const queueJobs = await redis.lrange('webhook:queue', 0, -1);
    const retryJobs = await redis.zrange('webhook:retry', 0, -1);
    
    const allPendingJobs = [...queueJobs, ...retryJobs];
    const pendingJob = allPendingJobs.find(jobData => {
      const job = JSON.parse(jobData);
      return job.payload.correlationId === correlationId;
    });

    if (pendingJob) {
      const job = JSON.parse(pendingJob);
      
      res.status(200).json({
        success: true,
        data: {
          correlationId,
          status: 'PENDING',
          attempts: job.attempts || 0,
          nextRetry: job.nextRetry,
          callbackUrl: job.callbackUrl,
          retrievedAt: new Date().toISOString()
        }
      });
      return;
    }

    // 히스토리 없음
    throw ApiError.notFound(`Webhook history not found for correlationId: ${correlationId}`);

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to retrieve webhook history for ${correlationId}:`, error);
    throw ApiError.internal('Failed to retrieve webhook history');
  }
}));

// 웹훅 수동 테스트 (개발용)
router.post('/test', publicRateLimiter, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { correlationId, callbackUrl, payload } = req.body;
  const requestId = req.id || 'unknown';

  if (!correlationId || !callbackUrl) {
    throw ApiError.badRequest('Missing required fields: correlationId, callbackUrl');
  }

  try {
    // 테스트 페이로드 생성
    const testPayload = payload || {
      txId: `test_${Date.now()}`,
      correlationId,
      status: 'COMMITTED',
      blockNumber: Math.floor(Math.random() * 1000) + 1,
      payloadHash: 'sha256:' + crypto.createHash('sha256').update(JSON.stringify({ test: true })).digest('hex')
    };

    // 콜백 URL 등록
    await redis.setex(
      `callback:${correlationId}`,
      3600, // 1시간
      JSON.stringify({
        callbackUrl,
        userId: 'test-user',
        createdAt: new Date().toISOString()
      })
    );

    // 웹훅 작업 추가
    await webhookService.addWebhookJob(correlationId, testPayload);

    logger.info(`Test webhook job added`, {
      requestId,
      correlationId,
      callbackUrl,
      payload: testPayload
    });

    res.status(200).json({
      success: true,
      message: 'Test webhook job added to queue',
      data: {
        correlationId,
        callbackUrl,
        payload: testPayload,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to add test webhook job:', error);
    throw ApiError.internal('Failed to add test webhook job');
  }
}));

export { router as webhookRouter };
