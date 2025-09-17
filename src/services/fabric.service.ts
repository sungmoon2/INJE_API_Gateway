import { Gateway, Wallets, Contract, Network, Wallet } from 'fabric-network';
import * as fs from 'fs';
import * as path from 'path';
import winston from 'winston';
import { RedisClient } from './redis.service';
import * as crypto from 'crypto';

interface TransactionPayload {
  containerId: string;
  instruction: string;
  source: string;
  timestamp: string;
}

interface TransactionResult {
  txId: string;
  status: 'SUBMITTED' | 'PENDING' | 'COMMITTED' | 'FAILED';
  blockNumber?: number;
  payloadHash?: string;
  error?: string;
}

export class FabricService {
  private static instance: FabricService;
  private gateway: Gateway;
  private wallet: Wallet | undefined;
  private network: Network | undefined;
  private contract: Contract | undefined;
  private logger: winston.Logger;
  private redis: RedisClient;

  private constructor() {
    this.gateway = new Gateway();
    this.logger = winston.createLogger({
      defaultMeta: { service: 'FabricService' },
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/fabric.log' })
      ]
    });
    this.redis = RedisClient.getInstance();
  }

  public static getInstance(): FabricService {
    if (!FabricService.instance) {
      FabricService.instance = new FabricService();
    }
    return FabricService.instance;
  }

  public async initialize(): Promise<void> {
    try {
      // Connection Profile 로드 (개발 환경에서는 간단한 설정 사용)
      const ccpPath = path.resolve(
        process.env.FABRIC_CONNECTION_PROFILE ||
        './config/connection-profile.json'
      );

      let ccp;
      if (fs.existsSync(ccpPath)) {
        ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
      } else {
        // 개발 환경용 기본 설정
        ccp = this.getDefaultConnectionProfile();
        this.logger.warn('Using default connection profile for development');
      }

      // Wallet 초기화
      await this.initializeWallet();

      // Gateway 연결
      await this.gateway.connect(ccp, {
        wallet: this.wallet,
        identity: process.env.FABRIC_USER_ID || 'appUser',
        discovery: {
          enabled: true,
          asLocalhost: process.env.NODE_ENV === 'development'
        }
      });

      // 네트워크 및 컨트랙트 획득
      this.network = await this.gateway.getNetwork(
        process.env.FABRIC_CHANNEL_NAME || 'newportchannel'
      );

      this.contract = this.network.getContract(
        process.env.FABRIC_CHAINCODE_NAME || 'abstore',
        process.env.FABRIC_CONTRACT_NAME || ''
      );

      // 블록 이벤트 리스너 등록
      await this.registerBlockListener();

      this.logger.info('Fabric service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Fabric service:', error);
      // 개발 환경에서는 오류를 무시하고 모의 모드로 실행
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn('Running in mock mode due to initialization failure');
      } else {
        throw error;
      }
    }
  }

  private getDefaultConnectionProfile(): any {
    return {
      name: 'inje-network',
      version: '1.0.0',
      client: {
        organization: 'CFS1',
        connection: {
          timeout: {
            peer: {
              endorser: '300'
            }
          }
        }
      },
      organizations: {
        CFS1: {
          mspid: 'CFS1MSP',
          peers: ['peer0.cfs1.example.com'],
          certificateAuthorities: ['ca.cfs1.example.com']
        }
      },
      peers: {
        'peer0.cfs1.example.com': {
          url: 'grpc://localhost:7051',
          grpcOptions: {
            'ssl-target-name-override': 'peer0.cfs1.example.com',
            'hostnameOverride': 'peer0.cfs1.example.com'
          }
        }
      },
      certificateAuthorities: {
        'ca.cfs1.example.com': {
          url: 'http://localhost:7054',
          caName: 'ca-cfs1',
          httpOptions: {
            verify: false
          }
        }
      }
    };
  }

  private async initializeWallet(): Promise<void> {
    try {
      const walletPath = path.join(process.cwd(), 'wallet');
      this.wallet = await Wallets.newFileSystemWallet(walletPath);

      // Admin 신원 확인 및 생성
      const adminIdentity = await this.wallet.get('admin');
      if (!adminIdentity && process.env.NODE_ENV !== 'development') {
        await this.createDevelopmentIdentities();
      }

      // User 신원 확인 및 생성
      const userIdentity = await this.wallet.get(
        process.env.FABRIC_USER_ID || 'appUser'
      );
      if (!userIdentity && process.env.NODE_ENV !== 'development') {
        await this.createDevelopmentIdentities();
      }
    } catch (error) {
      this.logger.error('Wallet initialization failed:', error);
      if (process.env.NODE_ENV === 'development') {
        await this.createDevelopmentIdentities();
      } else {
        throw error;
      }
    }
  }

  private async createDevelopmentIdentities(): Promise<void> {
    try {
      // 개발 환경용 모의 신원 생성
      const adminIdentity = {
        credentials: {
          certificate: '-----BEGIN CERTIFICATE-----\nDEVELOPMENT_CERT\n-----END CERTIFICATE-----',
          privateKey: '-----BEGIN PRIVATE KEY-----\nDEVELOPMENT_KEY\n-----END PRIVATE KEY-----',
        },
        mspId: process.env.FABRIC_MSP_ID || 'CFS1MSP',
        type: 'X.509',
      };

      const userIdentity = {
        credentials: {
          certificate: '-----BEGIN CERTIFICATE-----\nDEVELOPMENT_USER_CERT\n-----END CERTIFICATE-----',
          privateKey: '-----BEGIN PRIVATE KEY-----\nDEVELOPMENT_USER_KEY\n-----END PRIVATE KEY-----',
        },
        mspId: process.env.FABRIC_MSP_ID || 'CFS1MSP',
        type: 'X.509',
      };

      if (this.wallet) {
        await this.wallet.put('admin', adminIdentity);
        await this.wallet.put(process.env.FABRIC_USER_ID || 'appUser', userIdentity);
      }

      this.logger.info('Development identities created');
    } catch (error) {
      this.logger.error('Failed to create development identities:', error);
    }
  }

  public async submitTransaction(
    correlationId: string,
    payload: TransactionPayload
  ): Promise<TransactionResult> {
    try {
      // 멱등성 체크
      const existingTx = await this.redis.get(`tx:${correlationId}`);
      if (existingTx) {
        return JSON.parse(existingTx);
      }

      // 개발 환경에서는 모의 트랜잭션 생성
      if (process.env.NODE_ENV === 'development' || !this.contract) {
        return await this.submitMockTransaction(correlationId, payload);
      }

      // 실제 트랜잭션 제출
      const txProposal = this.contract.createTransaction('submitLogisticsData');
      const txId = txProposal.getTransactionId();

      // Redis에 PENDING 상태 저장
      const pendingResult: TransactionResult = {
        txId,
        status: 'PENDING'
      };

      await this.redis.setex(
        `tx:${correlationId}`,
        3600,
        JSON.stringify(pendingResult)
      );

      await this.redis.setex(
        `txid:${txId}`,
        3600,
        correlationId
      );

      // 체인코드 호출
      await txProposal.submit(
        JSON.stringify({
          correlationId,
          ...payload
        })
      );

      // 결과 처리
      const txResult: TransactionResult = {
        txId,
        status: 'SUBMITTED'
      };

      // Redis 업데이트
      await this.redis.setex(
        `tx:${correlationId}`,
        3600,
        JSON.stringify(txResult)
      );

      this.logger.info(`Transaction submitted: ${txId}`, {
        correlationId,
        payload
      });

      return txResult;
    } catch (error) {
      this.logger.error('Transaction submission failed:', error);

      const errorResult: TransactionResult = {
        txId: '',
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      await this.redis.setex(
        `tx:${correlationId}`,
        3600,
        JSON.stringify(errorResult)
      );

      throw error;
    }
  }

  private async submitMockTransaction(
    correlationId: string,
    payload: TransactionPayload
  ): Promise<TransactionResult> {
    // 개발 환경용 모의 트랜잭션
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const mockResult: TransactionResult = {
      txId,
      status: 'SUBMITTED'
    };

    // Redis에 저장
    await this.redis.setex(
      `tx:${correlationId}`,
      3600,
      JSON.stringify(mockResult)
    );

    await this.redis.setex(
      `txid:${txId}`,
      3600,
      correlationId
    );

    this.logger.info(`Mock transaction submitted: ${txId}`, {
      correlationId,
      payload
    });

    // 5초 후 COMMITTED 상태로 변경 (시뮬레이션)
    setTimeout(async () => {
      const committedResult: TransactionResult = {
        txId,
        status: 'COMMITTED',
        blockNumber: Math.floor(Math.random() * 1000) + 1,
        payloadHash: this.calculateHash(payload)
      };

      await this.redis.setex(
        `tx:${correlationId}`,
        86400,
        JSON.stringify(committedResult)
      );

      // 웹훅 트리거
      await this.redis.lpush(
        'webhook:queue',
        JSON.stringify({
          correlationId,
          ...committedResult
        })
      );

      this.logger.info(`Mock transaction committed: ${txId}`);
    }, 5000);

    return mockResult;
  }

  private async registerBlockListener(): Promise<void> {
    try {
      if (!this.network) {
        this.logger.warn('Network not initialized, skipping block listener registration');
        return;
      }

      await this.network.addBlockListener(
        async (blockEvent) => {
          const blockNumber = blockEvent.blockNumber.toString();
          this.logger.info(`Block ${blockNumber} received`);

          // 블록 내 트랜잭션 처리 (타입 안전성을 위해 조건부 처리)
          if ('data' in blockEvent.blockData) {
            const blockData = blockEvent.blockData as any;
            for (const txEvent of blockData.data || []) {
              if (txEvent.payload && txEvent.payload.header) {
                const txId = txEvent.payload.header.channel_header.tx_id;
                const correlationId = await this.redis.get(`txid:${txId}`);

                if (correlationId) {
                  // 트랜잭션 상태 업데이트
                  const committedResult: TransactionResult = {
                    txId,
                    status: 'COMMITTED',
                    blockNumber: parseInt(blockNumber),
                    payloadHash: this.calculateHash(txEvent.payload.data)
                  };

                  await this.redis.setex(
                    `tx:${correlationId}`,
                    86400,
                    JSON.stringify(committedResult)
                  );

                  // 웹훅 트리거
                  await this.redis.lpush(
                    'webhook:queue',
                    JSON.stringify({
                      correlationId,
                      ...committedResult
                    })
                  );

                  this.logger.info(`Transaction ${txId} committed in block ${blockNumber}`);
                }
              }
            }
          }
        },
        { startBlock: 0 }
      );

      this.logger.info('Block listener registered');
    } catch (error) {
      this.logger.error('Failed to register block listener:', error);
    }
  }

  private calculateHash(data: any): string {
    return 'sha256:' + crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  public async getTransactionStatus(txId: string): Promise<TransactionResult | null> {
    try {
      const correlationId = await this.redis.get(`txid:${txId}`);
      if (!correlationId) {
        return null;
      }

      const result = await this.redis.get(`tx:${correlationId}`);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      this.logger.error(`Failed to get transaction status for ${txId}:`, error);
      return null;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.gateway) {
        await this.gateway.disconnect();
        this.logger.info('Disconnected from Fabric network');
      }
    } catch (error) {
      this.logger.error('Error disconnecting from Fabric network:', error);
    }
  }
}