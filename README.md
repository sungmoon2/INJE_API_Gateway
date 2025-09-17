# Blockchain API Gateway

🌐 **Secure API Gateway for Blockchain Integration**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Hyperledger Fabric](https://img.shields.io/badge/Hyperledger%20Fabric-2.2+-orange.svg)](https://hyperledger-fabric.readthedocs.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-brightgreen.svg)](https://www.docker.com/)

---

## [🇺🇸 English](#english) | [🇰🇷 한국어](#korean)

---

<a id="english"></a>
## 📋 Overview

This API Gateway enables secure and reliable storage of transaction records and data on blockchain networks. When you need to store business data with **immutability**, **transparency**, and **distributed consensus**, our blockchain system provides a robust API Gateway that:

✨ **Seamlessly connects** your existing applications to Hyperledger Fabric blockchain
🔒 **Ensures data integrity** through cryptographic hashing and consensus mechanisms
🚀 **Provides enterprise-grade** authentication, rate limiting, and monitoring
📡 **Supports external connectivity** for distributed system integration

Whether you're building supply chain tracking, financial records, audit trails, or any system requiring tamper-proof data storage, this gateway serves as your trusted bridge to blockchain technology.

### 🎯 Key Features

- ✅ **RESTful API Gateway** with 8 comprehensive endpoints
- ✅ **Blockchain Integration** with Hyperledger Fabric SDK
- ✅ **Authentication System** using API key-based security
- ✅ **Webhook System** with retry logic and Dead Letter Queue
- ✅ **Rate Limiting** with Redis-backed distributed limiting
- ✅ **External Network Support** with ngrok tunneling capability
- ✅ **Mock Mode** for development and testing
- ✅ **Comprehensive Logging** with Winston structured logging
- ✅ **Docker Containerization** for easy deployment

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   USER System   │◄──►│  API Gateway    │◄──►│ Fabric Network  │
│                 │    │                 │    │                 │
│ - Web Interface │    │ - Authentication│    │ - Blockchain    │
│ - Business API  │    │ - Rate Limiting │    │ - Smart Contract│
│ - Webhooks      │    │ - Validation    │    │ - Consensus     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────┐
                       │    Redis    │
                       │             │
                       │ - Caching   │
                       │ - Sessions  │
                       │ - Queues    │
                       └─────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Redis server
- Hyperledger Fabric network (optional for mock mode)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/sungmoon2/INJE_API_Gateway.git
   cd inje-api-gateway
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis (using Docker)**
   ```bash
   docker-compose up -d inje-redis
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

The API Gateway will be available at `http://localhost:3001`

## 📡 API Endpoints

### Core Endpoints
- `GET /health` - Health check
- `GET /api/v1` - API information

### Transaction Management
- `POST /api/v1/transactions/submit` - Submit new transaction
- `GET /api/v1/transactions/status/:correlationId` - Get transaction status
- `GET /api/v1/transactions/tx/:txId/status` - Get status by transaction ID
- `POST /api/v1/transactions/retry/:correlationId` - Retry failed transaction

### Webhook Management
- `GET /api/v1/webhooks/status` - Webhook service status
- `POST /api/v1/webhooks/dlq/reprocess` - Reprocess dead letter queue
- `GET /api/v1/webhooks/history/:correlationId` - Webhook delivery history

## 🔧 Configuration

### Environment Variables

Key configuration options in `.env`:

```bash
# Server
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# Fabric Network
FABRIC_CONNECTION_PROFILE=./config/connection-profile.json
FABRIC_CHANNEL_NAME=your-channel-name
FABRIC_CHAINCODE_NAME=your-chaincode

# Security
API_KEYS=your-api-key-1,your-api-key-2
WEBHOOK_SECRET=your-webhook-secret
ALLOWED_ORIGINS=https://your-domain.com

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### API Authentication

Include your API key in requests:

```bash
curl -H "X-API-Key: your-api-key" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3001/api/v1/transactions/submit \
     -d '{"correlationId": "test-123", "containerId": "CONT-001", "instruction": "LOAD", "source": "API_TEST"}'
```

## 🐳 Docker Deployment

### Using Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f inje-api-gateway

# Stop services
docker-compose down
```

### Production Deployment

For production deployment with external network access:

```bash
# Start with external binding
HOST=0.0.0.0 PORT=3001 npm start

# Or use ngrok for tunneling
ngrok http 3001
```

## 🧪 Testing

### Local Testing

```bash
# Health check
curl http://localhost:3001/health

# Submit transaction
curl -X POST http://localhost:3001/api/v1/transactions/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"correlationId": "test-123", "containerId": "CONT-001", "instruction": "LOAD", "source": "TEST"}'
```

### External Network Testing

The gateway supports external network access through:
- ✅ Direct IP access (with port forwarding)
- ✅ ngrok tunneling for development
- ✅ Cloud deployment for production

## 📊 Monitoring & Logging

### Structured Logging

All operations are logged with:
- Request IDs for tracing
- User identification via API keys
- Performance metrics
- Error tracking with stack traces

### Log Files

- `logs/combined.log` - All application logs
- `logs/error.log` - Error-level logs only
- `logs/auth.log` - Authentication events
- `logs/fabric.log` - Blockchain operations
- `logs/webhook.log` - Webhook delivery logs

## 🔒 Security Features

- **API Key Authentication** with user identification
- **Rate Limiting** (100 requests/minute by default)
- **CORS Protection** with configurable origins
- **Security Headers** via Helmet middleware
- **Input Validation** for all API endpoints
- **HMAC Signature** verification for webhooks
- **Pre-commit Hooks** for sensitive data protection

## 🎯 Production Readiness

### ✅ Completed Features
- Full API implementation with 8 endpoints
- External network connectivity verified
- Mock mode for development
- Comprehensive error handling
- Docker containerization
- Structured logging
- Security middleware

### 🔄 Integration Options
1. **Direct Connection**: Connect user systems directly to API Gateway
2. **Tunneling**: Use ngrok for immediate external access
3. **Cloud Deployment**: Deploy to AWS/GCP/Azure with domain + SSL

## 📚 Documentation

Comprehensive documentation available in the `docs/` directory:
- `docs/MASTER_DOCUMENTATION.md` - Complete project overview
- `docs/logs/session-1/` - Development process documentation
- `docs/logs/session-2/` - External network verification
- `docs/logs/guides/` - User guides and setup instructions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

For questions and support:
- Create an issue in this repository
- Check the documentation in the `/docs` directory
- Review the comprehensive guides for troubleshooting

---

<a id="korean"></a>
# 블록체인 API 게이트웨이

🌐 **블록체인 통합을 위한 보안 API 게이트웨이**

## 📋 개요

이 API 게이트웨이는 거래 기록이나 데이터를 블록체인 네트워크에 안전하고 무결하게 저장할 수 있도록 지원합니다. **불변성**, **투명성**, **분산 합의**가 필요한 비즈니스 데이터를 저장해야 할 때, 우리의 블록체인 시스템은 다음과 같은 강력한 API 게이트웨이를 제공합니다:

✨ **기존 애플리케이션을** Hyperledger Fabric 블록체인에 seamlessly 연결
🔒 **암호화 해싱과 합의 메커니즘을** 통해 데이터 무결성 보장
🚀 **엔터프라이즈급** 인증, 속도 제한, 모니터링 제공
📡 **분산 시스템 통합을** 위한 외부 연결성 지원

공급망 추적, 금융 기록, 감사 추적, 또는 변조 방지 데이터 저장이 필요한 모든 시스템을 구축하는 경우, 이 게이트웨이는 블록체인 기술로의 신뢰할 수 있는 가교 역할을 합니다.

### 🎯 주요 기능

- ✅ **RESTful API 게이트웨이** - 8개의 포괄적인 엔드포인트
- ✅ **블록체인 통합** - Hyperledger Fabric SDK 사용
- ✅ **인증 시스템** - API 키 기반 보안
- ✅ **웹훅 시스템** - 재시도 로직 및 DLQ(Dead Letter Queue)
- ✅ **속도 제한** - Redis 기반 분산 제한
- ✅ **외부 네트워크 지원** - ngrok 터널링 기능
- ✅ **Mock 모드** - 개발 및 테스트용
- ✅ **포괄적 로깅** - Winston 구조화 로깅
- ✅ **Docker 컨테이너화** - 간편한 배포

## 🏗️ 아키텍처

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   사용자 시스템    │◄──►│  API Gateway    │◄──►│ Fabric Network  │
│                 │    │                 │    │                 │
│ - 웹 인터페이스     │    │ - 인증           │    │ - 블록체인        │
│ - 비즈니스 API    │    │ - 속도 제한       │    │ - 스마트 컨트랙트   │
│ - 웹훅           │    │ - 검증           │    │ - 합의           │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                       ┌─────────────┐
                       │    Redis    │
                       │             │
                       │ - 캐싱       │
                       │ - 세션       │
                       │ - 큐         │
                       └─────────────┘
```

## 🚀 빠른 시작

### 필수 요구사항

- Node.js 18+
- Docker & Docker Compose
- Redis 서버
- Hyperledger Fabric 네트워크 (Mock 모드의 경우 선택사항)

### 설치

1. **저장소 클론**
   ```bash
   git clone https://github.com/sungmoon2/INJE_API_Gateway.git
   cd inje-api-gateway
   ```

2. **의존성 설치**
   ```bash
   npm install
   ```

3. **환경 설정**
   ```bash
   cp .env.example .env
   # .env 파일을 사용자 설정에 맞게 편집
   ```

4. **Redis 시작 (Docker 사용)**
   ```bash
   docker-compose up -d inje-redis
   ```

5. **개발 서버 실행**
   ```bash
   npm run dev
   ```

API 게이트웨이는 `http://localhost:3001`에서 사용할 수 있습니다.

## 🔧 설정

### 환경 변수

`.env` 파일의 주요 설정 옵션:

```bash
# 서버
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

# Fabric 네트워크
FABRIC_CONNECTION_PROFILE=./config/connection-profile.json
FABRIC_CHANNEL_NAME=your-channel-name
FABRIC_CHAINCODE_NAME=your-chaincode

# 보안
API_KEYS=your-api-key-1,your-api-key-2
WEBHOOK_SECRET=your-webhook-secret
ALLOWED_ORIGINS=https://your-domain.com

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### API 인증

요청에 API 키를 포함하세요:

```bash
curl -H "X-API-Key: your-api-key" \
     -H "Content-Type: application/json" \
     -X POST http://localhost:3001/api/v1/transactions/submit \
     -d '{"correlationId": "test-123", "containerId": "CONT-001", "instruction": "LOAD", "source": "API_TEST"}'
```

## 🧪 테스트

### 로컬 테스트

```bash
# 상태 확인
curl http://localhost:3001/health

# 트랜잭션 제출
curl -X POST http://localhost:3001/api/v1/transactions/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"correlationId": "test-123", "containerId": "CONT-001", "instruction": "LOAD", "source": "TEST"}'
```

## 🔒 보안 기능

- **API 키 인증** - 사용자 식별 포함
- **속도 제한** - 기본 100회 요청/분
- **CORS 보호** - 설정 가능한 오리진
- **보안 헤더** - Helmet 미들웨어를 통한
- **입력 검증** - 모든 API 엔드포인트
- **HMAC 서명** - 웹훅 검증
- **Pre-commit Hook** - 민감 데이터 보호

## 📚 문서

`docs/` 디렉토리에서 포괄적인 문서를 확인할 수 있습니다:
- `docs/MASTER_DOCUMENTATION.md` - 완전한 프로젝트 개요
- `docs/logs/session-1/` - 개발 과정 문서
- `docs/logs/session-2/` - 외부 네트워크 검증
- `docs/logs/guides/` - 사용자 가이드 및 설정 지침

## 📞 지원

질문이나 지원이 필요한 경우:
- 이 저장소에 이슈 생성
- `/docs` 디렉토리의 문서 확인
- 포괄적인 가이드를 통한 문제 해결 검토

---

**🎉 Blockchain API Gateway - 안전한 블록체인 데이터 저장의 시작! 🌐🚀**