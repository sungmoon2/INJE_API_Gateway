# INJE API Gateway

🌐 **INJE University Private Blockchain API Gateway for KULS System Integration**

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)
[![Hyperledger Fabric](https://img.shields.io/badge/Hyperledger%20Fabric-2.2+-orange.svg)](https://hyperledger-fabric.readthedocs.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-brightgreen.svg)](https://www.docker.com/)

## 📋 Overview

This API Gateway serves as a bridge between the KULS (Korea University Logistics System) and Hyperledger Fabric blockchain network, enabling secure and scalable blockchain-based logistics data management.

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
│   KULS System   │◄──►│  API Gateway    │◄──►│ Fabric Network  │
│                 │    │                 │    │                 │
│ - Web Interface │    │ - Authentication│    │ - Blockchain    │
│ - Logistics API │    │ - Rate Limiting │    │ - Smart Contract│
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
   git clone https://github.com/YOUR_USERNAME/inje-api-gateway.git
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
   docker-compose up -d redis
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
docker-compose logs -f api-gateway

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
1. **Direct Connection**: Connect KULS system directly to API Gateway
2. **Tunneling**: Use ngrok for immediate external access
3. **Cloud Deployment**: Deploy to AWS/GCP/Azure with domain + SSL

## 📚 Documentation

Comprehensive documentation available in the `docs/` directory:
- `PROJECT_DEVELOPMENT_LOG.txt` - Complete development history
- `EXTERNAL_NETWORK_SETUP.txt` - External connectivity guide
- `USER_VERIFICATION_GUIDE.txt` - Manual testing instructions
- `CONFIGURATION_DETAILS_LOG.txt` - Detailed configuration guide

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏫 Academic Context

Developed for INJE University's blockchain research initiative, focusing on practical applications of Hyperledger Fabric in logistics and supply chain management.

## 📞 Support

For questions and support:
- Create an issue in this repository
- Check the documentation in the `/docs` directory
- Review the test guides for troubleshooting

---

**🎉 INJE API Gateway - Connecting KULS System to Blockchain! 🌐🚀**