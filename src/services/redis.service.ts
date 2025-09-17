import Redis from 'ioredis';
import winston from 'winston';

export class RedisClient {
  private static instance: RedisClient;
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;
  private logger: winston.Logger;
  private isConnected: boolean = false;

  private constructor() {
    this.logger = winston.createLogger({
      defaultMeta: { service: 'RedisClient' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/redis.log' })
      ]
    });

    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true
    };

    this.client = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);
    this.publisher = new Redis(redisConfig);

    this.setupEventHandlers();
  }

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      this.logger.info('Redis client connected');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis client error:', err);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.logger.warn('Redis connection closed');
      this.isConnected = false;
    });

    this.client.on('reconnecting', (delay: number) => {
      this.logger.info(`Reconnecting to Redis in ${delay}ms`);
    });
  }

  public async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect()
      ]);
      this.isConnected = true;
      this.logger.info('All Redis connections established');
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await Promise.all([
        this.client.quit(),
        this.subscriber.quit(),
        this.publisher.quit()
      ]);
      this.isConnected = false;
      this.logger.info('Disconnected from Redis');
    } catch (error) {
      this.logger.error('Error disconnecting from Redis:', error);
    }
  }

  // Key-Value 작업
  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async set(key: string, value: string): Promise<string> {
    return this.client.set(key, value);
  }

  public async setex(key: string, ttl: number, value: string): Promise<string> {
    return this.client.setex(key, ttl, value);
  }

  public async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  public async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  public async expire(key: string, ttl: number): Promise<number> {
    return this.client.expire(key, ttl);
  }

  public async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // List 작업
  public async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  public async rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  public async lpop(key: string): Promise<string | null> {
    return this.client.lpop(key);
  }

  public async rpop(key: string): Promise<string | null> {
    return this.client.rpop(key);
  }

  public async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  public async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  public async lrem(key: string, count: number, element: string): Promise<number> {
    return this.client.lrem(key, count, element);
  }

  // Sorted Set 작업
  public async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  public async zrem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }

  public async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  public async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  public async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  // Pub/Sub 작업
  public async publish(channel: string, message: string): Promise<number> {
    return this.publisher.publish(channel, message);
  }

  public async subscribe(
    channel: string,
    callback: (message: string) => void
  ): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(message);
      }
    });
  }

  public async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  // 유틸리티
  public async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  public async scan(
    cursor: string | number,
    options?: { match?: string; count?: number }
  ): Promise<[string, string[]]> {
    if (options) {
      return this.client.scan(cursor, 'MATCH', options.match || '*', 'COUNT', options.count || 10);
    }
    return this.client.scan(cursor);
  }

  public async ping(): Promise<string> {
    return this.client.ping();
  }

  public isHealthy(): boolean {
    return this.isConnected;
  }

  // Rate Limiting 헬퍼
  public async checkRateLimit(
    key: string,
    limit: number,
    window: number
  ): Promise<boolean> {
    const current = await this.incr(key);

    if (current === 1) {
      await this.expire(key, window);
    }

    return current <= limit;
  }

  public async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  public async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // 분산 락
  public async acquireLock(
    lockKey: string,
    ttl: number = 5000
  ): Promise<boolean> {
    const lockId = `${Date.now()}-${Math.random()}`;
    const result = await this.client.set(
      `lock:${lockKey}`,
      lockId,
      'PX',
      ttl,
      'NX'
    );
    return result === 'OK';
  }

  public async releaseLock(lockKey: string): Promise<boolean> {
    const result = await this.del(`lock:${lockKey}`);
    return result === 1;
  }
}