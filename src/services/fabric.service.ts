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

      // 실제 블록체인 연동 시도 (FABRIC_USE_REAL_BLOCKCHAIN 환경변수로 제어)
      if (process.env.FABRIC_USE_REAL_BLOCKCHAIN === 'true') {
        return await this.submitRealBlockchainTransaction(correlationId, payload);
      }

      // FABRIC_USE_REAL_BLOCKCHAIN이 false이거나 설정되지 않은 경우 모의 트랜잭션 사용
      return await this.submitMockTransaction(correlationId, payload);
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

  /**
   * 실제 블록체인 트랜잭션 제출 함수
   * ContainerTracker 체인코드와 직접 연동
   */
  private async submitRealBlockchainTransaction(
    correlationId: string,
    payload: TransactionPayload
  ): Promise<TransactionResult> {
    try {
      this.logger.info(`Submitting real blockchain transaction: ${correlationId}`);

      // Connection Profile과 Gateway가 제대로 설정되었는지 확인
      if (!this.contract) {
        await this.initialize();
      }

      if (!this.contract) {
        throw new Error('Fabric contract not available');
      }

      // ContainerTracker 체인코드 함수 매핑
      let result: any;
      let txId: string;

      // 컨테이너 존재 여부 확인
      try {
        await this.contract.evaluateTransaction(
          'GetContainer',
          payload.containerId
        );

        // 컨테이너가 존재하면 위치 업데이트
        this.logger.info(`Container ${payload.containerId} exists, updating location`);

        result = await this.contract.submitTransaction(
          'UpdateLocation',
          payload.containerId,
          this.parseLocationFromInstruction(payload.instruction),
          payload.source,
          this.parseStatusFromInstruction(payload.instruction),
          `API Request: ${correlationId} at ${payload.timestamp}`
        );

        txId = this.generateTxId(correlationId);
        this.logger.info(`Container location updated - TxId: ${txId}`);

      } catch (error) {
        // 컨테이너가 존재하지 않으면 새로 등록
        this.logger.info(`Container ${payload.containerId} not found, registering new container`);

        result = await this.contract.submitTransaction(
          'RegisterContainer',
          payload.containerId,
          payload.source || 'API_GATEWAY',
          correlationId,
          '40FT', // 기본 크기
          'DRY',  // 기본 타입
          'INJE'  // 기본 소유자
        );

        txId = this.generateTxId(correlationId);
        this.logger.info(`New container registered - TxId: ${txId}`);
      }

      // 트랜잭션 결과 생성
      const transactionResult: TransactionResult = {
        txId,
        status: 'COMMITTED', // Fabric에서 즉시 커밋됨
        blockNumber: await this.getCurrentBlockHeight(),
        payloadHash: this.calculateHash(JSON.stringify(payload))
      };

      // Redis에 결과 저장
      await this.redis.setex(
        `tx:${correlationId}`,
        86400, // 24시간
        JSON.stringify(transactionResult)
      );

      // 웹훅 큐에 추가
      await this.redis.lpush(
        'webhook:queue',
        JSON.stringify({
          correlationId,
          ...transactionResult,
          blockchainResult: result.toString()
        })
      );

      this.logger.info(`Real blockchain transaction completed: ${txId}`, {
        correlationId,
        containerId: payload.containerId,
        instruction: payload.instruction,
        blockNumber: transactionResult.blockNumber
      });

      return transactionResult;

    } catch (error) {
      this.logger.error(`Real blockchain transaction failed: ${correlationId}`, error);

      // 실패한 트랜잭션도 기록
      const failedResult: TransactionResult = {
        txId: this.generateTxId(correlationId),
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error)
      };

      await this.redis.setex(
        `tx:${correlationId}`,
        86400,
        JSON.stringify(failedResult)
      );

      throw error;
    }
  }

  /**
   * API instruction을 체인코드 location으로 변환
   */
  private parseLocationFromInstruction(instruction: string): string {
    const locationMap: { [key: string]: string } = {
      'LOAD': 'CFS1-LOADING',
      'UNLOAD': 'CY1-DISCHARGE',
      'MOVE': 'TRANSPORT',
      'DELIVERED': 'DELIVERY_ZONE',
      'ARRIVED': 'GATE',
      'INSPECT': 'INSPECTION_AREA'
    };

    return locationMap[instruction.toUpperCase()] || 'UNKNOWN_LOCATION';
  }

  /**
   * API instruction을 체인코드 status로 변환
   */
  private parseStatusFromInstruction(instruction: string): string {
    const statusMap: { [key: string]: string } = {
      'LOAD': 'LOADING',
      'UNLOAD': 'DISCHARGED',
      'MOVE': 'IN_TRANSIT',
      'DELIVERED': 'DELIVERED',
      'ARRIVED': 'ARRIVED',
      'INSPECT': 'INSPECTING'
    };

    return statusMap[instruction.toUpperCase()] || 'PROCESSING';
  }

  /**
   * 현재 블록 높이 조회
   */
  private async getCurrentBlockHeight(): Promise<number> {
    try {
      if (!this.network) {
        return 0;
      }

      // 네트워크에서 최신 블록 정보 조회
      // queryInfo가 없을 경우 대안 방법 사용
      const channel = this.network.getChannel();
      if ('queryInfo' in channel && typeof channel.queryInfo === 'function') {
        const blockInfo = await (channel as any).queryInfo();
        return parseInt(blockInfo.height.toString());
      } else {
        // 대안: timestamp 기반 추정값 반환
        return Math.floor(Date.now() / 1000);
      }
    } catch (error) {
      this.logger.warn('Failed to get current block height:', error);
      return 0;
    }
  }

  /**
   * 트랜잭션 ID 생성
   */
  private generateTxId(correlationId: string): string {
    return `tx_${Date.now()}_${correlationId.substring(0, 8)}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * 실제 블록체인 상태 조회 함수
   */
  public async getRealTransactionStatus(correlationId: string): Promise<TransactionResult | null> {
    try {
      // Redis에서 먼저 확인
      const cachedResult = await this.redis.get(`tx:${correlationId}`);
      if (cachedResult) {
        return JSON.parse(cachedResult);
      }

      // 블록체인에서 직접 조회는 correlationId 기반으로는 어려움
      // 대신 Redis 캐시에 의존
      this.logger.warn(`Transaction ${correlationId} not found in cache`);
      return null;

    } catch (error) {
      this.logger.error(`Failed to get real transaction status: ${correlationId}`, error);
      return null;
    }
  }
}