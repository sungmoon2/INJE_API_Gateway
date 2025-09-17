import axios from 'axios';
import * as crypto from 'crypto';
import winston from 'winston';
import { RedisClient } from './redis.service';

interface WebhookPayload {
  txId: string;
  correlationId: string;
  status: 'COMMITTED' | 'FAILED';
  blockNumber?: number;
  payloadHash?: string;
  error?: string;
}

interface WebhookJob {
  id: string;
  payload: WebhookPayload;
  callbackUrl: string;
  attempts: number;
  maxAttempts: number;
  nextRetry?: number;
  lastError?: string;
}

export class WebhookService {
  private static instance: WebhookService;
  private redis: RedisClient;
  private logger: winston.Logger;
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | undefined;

  private readonly MAX_RETRIES = 5;
  private readonly RETRY_DELAYS = [1000, 5000, 15000, 60000, 300000]; // 1s, 5s, 15s, 1m, 5m

  private constructor() {
    this.redis = RedisClient.getInstance();
    this.logger = winston.createLogger({
      defaultMeta: { service: 'WebhookService' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/webhook.log' })
      ]
    });
  }

  public static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  public async start(): Promise<void> {
    if (this.isProcessing) {
      this.logger.warn('Webhook service already running');
      return;
    }

    this.isProcessing = true;
    this.logger.info('Webhook service started');

    // 주기적으로 큐 처리
    this.processingInterval = setInterval(async () => {
      await this.processQueue();
      await this.processRetryQueue();
    }, 5000); // 5초마다 실행

    // 즉시 한 번 실행
    await this.processQueue();
  }

  public async stop(): Promise<void> {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.logger.info('Webhook service stopped');
  }

  public async addWebhookJob(
    correlationId: string,
    payload: WebhookPayload
  ): Promise<void> {
    try {
      // correlationId로 callback URL 조회
      const callbackData = await this.redis.get(`callback:${correlationId}`);
      if (!callbackData) {
        this.logger.error(`No callback URL found for ${correlationId}`);
        return;
      }

      const { callbackUrl } = JSON.parse(callbackData);

      const job: WebhookJob = {
        id: `webhook:${correlationId}:${Date.now()}`,
        payload,
        callbackUrl,
        attempts: 0,
        maxAttempts: this.MAX_RETRIES
      };

      // 웹훅 큐에 추가
      await this.redis.lpush('webhook:queue', JSON.stringify(job));
      this.logger.info(`Webhook job added for ${correlationId}`);
    } catch (error) {
      this.logger.error('Failed to add webhook job:', error);
    }
  }

  private async processQueue(): Promise<void> {
    if (!this.isProcessing) return;

    try {
      // 큐에서 작업 가져오기 (FIFO)
      const jobData = await this.redis.rpop('webhook:queue');
      if (!jobData) return;

      const job: WebhookJob = JSON.parse(jobData);
      await this.sendWebhook(job);
    } catch (error) {
      this.logger.error('Error processing webhook queue:', error);
    }
  }

  private async processRetryQueue(): Promise<void> {
    if (!this.isProcessing) return;

    try {
      const now = Date.now();

      // 재시도 큐에서 시간이 된 작업들 가져오기
      const retryJobs = await this.redis.zrangebyscore(
        'webhook:retry',
        0,
        now
      );

      for (const jobData of retryJobs) {
        const job: WebhookJob = JSON.parse(jobData);

        // 재시도 큐에서 제거
        await this.redis.zrem('webhook:retry', jobData);

        // 다시 시도
        await this.sendWebhook(job);
      }
    } catch (error) {
      this.logger.error('Error processing retry queue:', error);
    }
  }

  private async sendWebhook(job: WebhookJob): Promise<void> {
    try {
      job.attempts++;

      // 서명 생성
      const signature = this.generateSignature(job.payload);

      // HTTP 요청 전송
      const response = await axios.post(
        job.callbackUrl,
        job.payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-INJE-Signature': signature,
            'X-INJE-Timestamp': new Date().toISOString(),
            'X-INJE-Attempt': job.attempts.toString()
          },
          timeout: 30000, // 30초 타임아웃
          validateStatus: (status) => status < 500 // 5xx는 재시도
        }
      );

      // 성공 로그
      this.logger.info(`Webhook sent successfully`, {
        jobId: job.id,
        correlationId: job.payload.correlationId,
        status: response.status,
        attempts: job.attempts
      });

      // 성공 이력 저장
      await this.redis.setex(
        `webhook:success:${job.payload.correlationId}`,
        86400, // 24시간
        JSON.stringify({
          ...job,
          completedAt: new Date().toISOString(),
          responseStatus: response.status
        })
      );

    } catch (error) {
      await this.handleWebhookError(job, error);
    }
  }

  private async handleWebhookError(
    job: WebhookJob,
    error: any
  ): Promise<void> {
    const status = error.response?.status;
    const errorMessage = error.message;

    job.lastError = errorMessage;

    this.logger.error('Webhook delivery failed', {
      jobId: job.id,
      correlationId: job.payload.correlationId,
      attempt: job.attempts,
      error: errorMessage,
      status
    });

    // 재시도 가능 여부 판단
    const shouldRetry = this.shouldRetry(job, error);

    if (shouldRetry && job.attempts < job.maxAttempts) {
      // 재시도 스케줄링
      const delay = this.RETRY_DELAYS[job.attempts - 1] || 300000;
      job.nextRetry = Date.now() + delay;

      await this.redis.zadd(
        'webhook:retry',
        job.nextRetry,
        JSON.stringify(job)
      );

      this.logger.info(`Webhook scheduled for retry`, {
        jobId: job.id,
        nextRetry: new Date(job.nextRetry).toISOString(),
        attempt: job.attempts
      });
    } else {
      // Dead Letter Queue로 이동
      await this.moveToDeadLetterQueue(job);
    }
  }

  private shouldRetry(_job: WebhookJob, error: any): boolean {
    if (!error.isAxiosError) return true; // 네트워크 에러는 재시도

    const status = error.response?.status;

    // 4xx 에러는 재시도하지 않음 (클라이언트 오류)
    if (status >= 400 && status < 500) {
      // 429 (Rate Limit)와 408 (Timeout)은 재시도
      return status === 429 || status === 408;
    }

    // 5xx 에러는 재시도
    return status >= 500;
  }

  private async moveToDeadLetterQueue(job: WebhookJob): Promise<void> {
    await this.redis.lpush('webhook:dlq', JSON.stringify({
      ...job,
      movedToDLQ: new Date().toISOString()
    }));

    this.logger.error(`Webhook moved to DLQ`, {
      jobId: job.id,
      correlationId: job.payload.correlationId,
      attempts: job.attempts,
      lastError: job.lastError
    });

    // DLQ 알림 (운영 모니터링용)
    await this.sendDLQAlert(job);
  }

  private async sendDLQAlert(job: WebhookJob): Promise<void> {
    // Slack, Email 등으로 알림 전송
    // 구현 예정
    this.logger.warn('DLQ Alert:', {
      correlationId: job.payload.correlationId,
      callbackUrl: job.callbackUrl,
      attempts: job.attempts
    });
  }

  private generateSignature(payload: any): string {
    const secret = process.env.WEBHOOK_SECRET || 'inje-webhook-secret';
    const timestamp = Date.now().toString();
    const data = `${timestamp}.${JSON.stringify(payload)}`;

    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
  }

  public async reprocessDLQ(): Promise<number> {
    let count = 0;

    while (true) {
      const jobData = await this.redis.rpop('webhook:dlq');
      if (!jobData) break;

      const job: WebhookJob = JSON.parse(jobData);
      job.attempts = 0; // 재시도 카운트 리셋

      await this.redis.lpush('webhook:queue', JSON.stringify(job));
      count++;
    }

    this.logger.info(`Reprocessed ${count} jobs from DLQ`);
    return count;
  }

  public async getStats(): Promise<any> {
    const queueLength = await this.redis.llen('webhook:queue');
    const retryLength = await this.redis.zcard('webhook:retry');
    const dlqLength = await this.redis.llen('webhook:dlq');

    return {
      queue: queueLength,
      retry: retryLength,
      dlq: dlqLength,
      processing: this.isProcessing
    };
  }
}