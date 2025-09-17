import { Router, Request, Response } from 'express';
import { FabricService } from '../services/fabric.service';
import { RedisClient } from '../services/redis.service';
import { asyncHandler, ApiError } from '../middleware/error.middleware';
import winston from 'winston';

interface AuthenticatedRequest extends Request {
  userId?: string;
  apiKey?: string;
  id?: string;
}

const router = Router();
const fabricService = FabricService.getInstance();
const redis = RedisClient.getInstance();

const logger = winston.createLogger({
  defaultMeta: { service: 'FabricRoutes' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/fabric.log' })
  ]
});

// 트랜잭션 제출 API
router.post('/submit', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { correlationId, containerId, instruction, source, callbackUrl } = req.body;
  const requestId = req.id || 'unknown';
  const userId = req.userId || 'anonymous';

  // 입력 유효성 검증
  if (!correlationId || !containerId || !instruction || !source) {
    throw ApiError.badRequest('Missing required fields: correlationId, containerId, instruction, source');
  }

  // correlationId 중복 찍
  const existingTransaction = await redis.get(`tx:${correlationId}`);
  if (existingTransaction) {
    const txResult = JSON.parse(existingTransaction);
    logger.info(`Duplicate transaction request for ${correlationId}`, {
      requestId,
      correlationId,
      existingStatus: txResult.status
    });
    
    res.status(200).json({
      success: true,
      message: 'Transaction already exists',
      data: txResult,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // 콜백 URL 저장 (웹훅용)
  if (callbackUrl) {
    await redis.setex(
      `callback:${correlationId}`,
      86400, // 24시간
      JSON.stringify({ 
        callbackUrl, 
        userId,
        createdAt: new Date().toISOString() 
      })
    );
  }

  try {
    // 트랜잭션 제출
    const result = await fabricService.submitTransaction(correlationId, {
      containerId,
      instruction,
      source,
      timestamp: new Date().toISOString()
    });

    logger.info(`Transaction submitted successfully`, {
      requestId,
      correlationId,
      txId: result.txId,
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Transaction submitted successfully',
      data: {
        correlationId,
        txId: result.txId,
        status: result.status,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`Transaction submission failed for ${correlationId}:`, error);
    throw ApiError.internal('Transaction submission failed', {
      correlationId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// 트랜잭션 상태 조회 API
router.get('/status/:correlationId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { correlationId } = req.params;
  const requestId = req.id || 'unknown';

  if (!correlationId) {
    throw ApiError.badRequest('Missing correlationId parameter');
  }

  try {
    const result = await redis.get(`tx:${correlationId}`);
    
    if (!result) {
      throw ApiError.notFound(`Transaction not found for correlationId: ${correlationId}`);
    }

    const transactionResult = JSON.parse(result);

    logger.debug(`Transaction status retrieved`, {
      requestId,
      correlationId,
      status: transactionResult.status
    });

    res.status(200).json({
      success: true,
      data: {
        correlationId,
        ...transactionResult,
        retrievedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to retrieve transaction status for ${correlationId}:`, error);
    throw ApiError.internal('Failed to retrieve transaction status');
  }
}));

// 트랜잭션 ID로 상태 조회 API
router.get('/tx/:txId/status', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { txId } = req.params;
  const requestId = req.id || 'unknown';

  if (!txId) {
    throw ApiError.badRequest('Missing txId parameter');
  }

  try {
    const result = await fabricService.getTransactionStatus(txId);
    
    if (!result) {
      throw ApiError.notFound(`Transaction not found for txId: ${txId}`);
    }

    logger.debug(`Transaction status retrieved by txId`, {
      requestId,
      txId,
      status: result.status
    });

    res.status(200).json({
      success: true,
      data: {
        transactionId: txId,
        ...result,
        retrievedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to retrieve transaction status for txId ${txId}:`, error);
    throw ApiError.internal('Failed to retrieve transaction status');
  }
}));

// 대벍 조회 API (개발/디버깅용)
router.get('/transactions', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { status, limit = '10', offset = '0' } = req.query;
  const requestId = req.id || 'unknown';

  try {
    // Redis에서 트랜잭션 목록 조회
    const pattern = status ? `tx:*:${status}` : 'tx:*';
    const keys = await redis.keys(pattern);
    
    const limitNum = parseInt(limit as string);
    const offsetNum = parseInt(offset as string);
    
    const paginatedKeys = keys.slice(offsetNum, offsetNum + limitNum);
    
    const transactions = [];
    for (const key of paginatedKeys) {
      const data = await redis.get(key);
      if (data) {
        const correlationId = key.replace('tx:', '');
        transactions.push({
          correlationId,
          ...JSON.parse(data)
        });
      }
    }

    logger.debug(`Retrieved ${transactions.length} transactions`, {
      requestId,
      total: keys.length,
      limit: limitNum,
      offset: offsetNum
    });

    res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          total: keys.length,
          limit: limitNum,
          offset: offsetNum,
          hasMore: offsetNum + limitNum < keys.length
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to retrieve transactions:', error);
    throw ApiError.internal('Failed to retrieve transactions');
  }
}));

// 트랜잭션 재전송 API (실패한 트랜잭션 대상)
router.post('/retry/:correlationId', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { correlationId } = req.params;
  const requestId = req.id || 'unknown';
  const userId = req.userId || 'anonymous';

  if (!correlationId) {
    throw ApiError.badRequest('Missing correlationId parameter');
  }

  try {
    const existingTx = await redis.get(`tx:${correlationId}`);
    
    if (!existingTx) {
      throw ApiError.notFound(`Transaction not found for correlationId: ${correlationId}`);
    }

    const txResult = JSON.parse(existingTx);
    
    if (txResult.status === 'COMMITTED') {
      throw ApiError.badRequest('Transaction already committed, cannot retry');
    }

    if (txResult.status === 'PENDING') {
      throw ApiError.badRequest('Transaction is pending, cannot retry');
    }

    // 원본 데이터 조회
    const callbackData = await redis.get(`callback:${correlationId}`);
    if (!callbackData) {
      throw ApiError.notFound('Original transaction data not found');
    }

    // 기존 트랜잭션 데이터 삭제
    await redis.del(`tx:${correlationId}`);
    if (txResult.txId) {
      await redis.del(`txid:${txResult.txId}`);
    }

    logger.info(`Retrying transaction ${correlationId}`, {
      requestId,
      correlationId,
      previousStatus: txResult.status,
      userId
    });

    res.status(200).json({
      success: true,
      message: 'Transaction retry initiated. Submit the transaction again.',
      data: {
        correlationId,
        previousStatus: txResult.status,
        retryAt: new Date().toISOString()
      }
    });

  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error(`Failed to retry transaction ${correlationId}:`, error);
    throw ApiError.internal('Failed to retry transaction');
  }
}));

export { router as fabricRouter };
