# INJE API Gateway - Hyperledger Fabric 블록체인 연동 구현 계획서

## 📋 프로젝트 개요

### 목표
INJE API Gateway의 Mock 모드를 실제 Hyperledger Fabric 블록체인 네트워크와 연동하여 외부 클라이언트가 체인코드 함수를 호출하고 실제 블록이 생성되도록 구현

### 현재 상태 분석
- ✅ API Gateway: 완전 구현됨 (13개 엔드포인트, Mock 모드 작동 중)
- ✅ Fabric 네트워크: 운영 중 (4개 체인코드 배포 완료)
- ✅ 외부 네트워크 테스트: 완료 (3개 네트워크에서 테스트 성공)
- ❌ 실제 블록체인 연동: 미완료 (Connection Profile 및 환경 변수 설정 필요)

### 체인코드 현황
```
Name: abstore, Version: 1.0, Sequence: 1
Name: containerrouting, Version: 1.0, Sequence: 1
Name: containertracker, Version: 1.0, Sequence: 1  ← 주요 타겟
Name: memberregistry, Version: 1.0, Sequence: 1
```

## 🎯 1단계: 환경 설정 및 연결 구성 (2시간)

### 1.1 환경 변수 수정 (30분)

**파일:** `/home/minsujo/inje-api-gateway/.env`

**현재 설정:**
```bash
FABRIC_CHAINCODE_NAME=inje-chaincode  # ❌ 잘못된 체인코드 이름
FABRIC_CONTRACT_NAME=LogisticsContract # ❌ 잘못된 컨트랙트 이름
FABRIC_USER_ID=appUser
```

**수정할 설정:**
```bash
FABRIC_CHAINCODE_NAME=containertracker  # ✅ 실제 배포된 체인코드 이름
FABRIC_CONTRACT_NAME=ContainerTracker   # ✅ 실제 컨트랙트 이름 (Go struct명)
FABRIC_USER_ID=appUser
```

**명령어:**
```bash
cd /home/minsujo/inje-api-gateway
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
sed -i 's/FABRIC_CHAINCODE_NAME=inje-chaincode/FABRIC_CHAINCODE_NAME=containertracker/' .env
sed -i 's/FABRIC_CONTRACT_NAME=LogisticsContract/FABRIC_CONTRACT_NAME=ContainerTracker/' .env
```

### 1.2 Connection Profile 검증 (30분)

**파일:** `/home/minsujo/inje-api-gateway/config/connection-profile.json`

**검증 명령어:**
```bash
# 연결 테스트
docker exec cli peer chaincode query -C newportchannel -n containertracker -c '{"Args":["GetContainer","TEMU1234567"]}'
```

**예상 결과:** 컨테이너 정보가 JSON 형태로 반환되어야 함

### 1.3 Wallet 설정 (1시간)

**목표:** API Gateway에서 사용할 사용자 인증서 설정

**단계:**
1. 기존 crypto 자료 확인
2. appUser 인증서 생성 또는 복사
3. Wallet 디렉토리 구조 확인

**명령어:**
```bash
# Fabric 네트워크의 기존 인증서 확인
ls -la /home/minsujo/fabric-network/organizations/peerOrganizations/cfs1.example.com/users/

# API Gateway wallet 디렉토리 생성
mkdir -p /home/minsujo/inje-api-gateway/wallet

# 기존 사용자 인증서가 있다면 복사
# (이 부분은 실제 상황에 따라 조정 필요)
```

## 🔧 2단계: API Gateway 서비스 수정 (3시간)

### 2.1 FabricService 클래스 수정 (2시간)

**파일:** `/home/minsujo/inje-api-gateway/src/services/fabric.service.ts`

**주요 수정 사항:**

1. **Connection Profile 로드 로직 개선**
```typescript
// 기존 코드의 개발 환경 기본 설정을 실제 네트워크 설정으로 변경
private getDefaultConnectionProfile(): any {
  // 실제 connection-profile.json 파일 내용 반환
}
```

2. **체인코드 함수 매핑 추가**
```typescript
// ContainerTracker 체인코드 함수들과 매핑
public async submitTransaction(correlationId: string, payload: TransactionPayload): Promise<TransactionResult> {
  // containertracker 체인코드의 RegisterContainer, UpdateLocation, UpdateStatus 함수 호출
}

public async queryContainer(containerId: string): Promise<any> {
  return await this.contract.evaluateTransaction('GetContainer', containerId);
}

public async getAllContainers(): Promise<any> {
  return await this.contract.evaluateTransaction('GetAllContainers');
}
```

3. **에러 처리 개선**
```typescript
// LevelDB 쿼리 제한 사항 처리
// GetAllContainers 함수가 LevelDB에서 작동하지 않으므로 대안 제공
```

### 2.2 라우트 핸들러 수정 (1시간)

**파일:** `/home/minsujo/inje-api-gateway/src/routes/fabric.routes.ts`

**수정 사항:**
1. 체인코드 함수 파라미터를 ContainerTracker 스키마에 맞게 조정
2. 에러 응답 메시지 개선
3. 실제 블록체인 응답 형태에 맞는 응답 구조 수정

## 📊 3단계: 체인코드 호환성 테스트 (2시간)

### 3.1 기본 쿼리 함수 테스트 (30분)

**목표:** 가장 단순한 함수부터 단계별 테스트

**테스트 순서:**
```bash
# 1. 개별 컨테이너 조회 (가장 단순한 함수)
docker exec cli peer chaincode query -C newportchannel -n containertracker -c '{"Args":["GetContainer","TEMU1234567"]}'

# 2. 컨테이너 존재 확인
docker exec cli peer chaincode query -C newportchannel -n containertracker -c '{"Args":["ContainerExists","TEMU1234567"]}'

# 3. 현재 위치 조회
docker exec cli peer chaincode query -C newportchannel -n containertracker -c '{"Args":["GetCurrentLocation","TEMU1234567"]}'
```

### 3.2 트랜잭션 함수 테스트 (1시간)

**테스트 순서:**
```bash
# 1. 새 컨테이너 등록
docker exec cli peer chaincode invoke \
  -o orderer.example.com:7050 --tls \
  --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C newportchannel -n containertracker \
  --peerAddresses peer0.cfs1.example.com:7051 \
  --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/peerOrganizations/cfs1.example.com/peers/peer0.cfs1.example.com/tls/ca.crt \
  -c '{"Args":["RegisterContainer","TEST001","TEST_VESSEL","TEST_VOYAGE","40FT","DRY","TestOwner"]}'

# 2. 위치 업데이트
docker exec cli peer chaincode invoke \
  -o orderer.example.com:7050 --tls \
  --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C newportchannel -n containertracker \
  --peerAddresses peer0.cfs1.example.com:7051 \
  --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/peerOrganizations/cfs1.example.com/peers/peer0.cfs1.example.com/tls/ca.crt \
  -c '{"Args":["UpdateLocation","TEST001","CFS1-A15","SYSTEM","LOADING","테스트 업데이트"]}'
```

### 3.3 API Gateway 연동 테스트 (30분)

**명령어:**
```bash
# API Gateway 시작
cd /home/minsujo/inje-api-gateway
npm run dev

# 별도 터미널에서 테스트
curl -X POST http://localhost:3000/api/fabric/submit \
  -H "Content-Type: application/json" \
  -H "X-API-Key: kuls-api-key-2025" \
  -d '{
    "correlationId": "test-001",
    "containerId": "API-TEST-001",
    "instruction": "REGISTER_CONTAINER",
    "source": "API_GATEWAY_TEST"
  }'
```

## 🚀 4단계: 실제 연동 구현 (4시간)

### 4.1 InitLedger 실행 (30분)

**목표:** 체인코드 초기 데이터 로딩

**명령어:**
```bash
docker exec cli peer chaincode invoke \
  -o orderer.example.com:7050 --tls \
  --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C newportchannel -n containertracker \
  --peerAddresses peer0.cfs1.example.com:7051 \
  --tlsRootCertFiles /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto-config/peerOrganizations/cfs1.example.com/peers/peer0.cfs1.example.com/tls/ca.crt \
  -c '{"Args":["InitLedger"]}'
```

### 4.2 API Gateway 함수별 구현 (3시간)

#### 4.2.1 컨테이너 조회 API 구현 (45분)

**엔드포인트:** `GET /api/containers/:containerId`

**체인코드 매핑:**
- API 함수: `getContainer`
- 체인코드 함수: `GetContainer`

**구현:**
```typescript
// src/routes/container.routes.ts에 추가
router.get('/:containerId', async (req, res) => {
  const { containerId } = req.params;
  const result = await fabricService.queryTransaction('GetContainer', [containerId]);
  res.json(result);
});
```

#### 4.2.2 컨테이너 등록 API 구현 (45분)

**엔드포인트:** `POST /api/containers`

**체인코드 매핑:**
- API 함수: `registerContainer`
- 체인코드 함수: `RegisterContainer`

**구현:**
```typescript
router.post('/', async (req, res) => {
  const { containerID, vesselName, voyage, size, type, owner } = req.body;
  const result = await fabricService.submitTransaction('RegisterContainer',
    [containerID, vesselName, voyage, size, type, owner]);
  res.json(result);
});
```

#### 4.2.3 위치 업데이트 API 구현 (45분)

**엔드포인트:** `PATCH /api/containers/:containerId/location`

**체인코드 매핑:**
- API 함수: `updateContainerLocation`
- 체인코드 함수: `UpdateLocation`

#### 4.2.4 상태 업데이트 API 구현 (45분)

**엔드포인트:** `PATCH /api/containers/:containerId/status`

**체인코드 매핑:**
- API 함수: `updateContainerStatus`
- 체인코드 함수: `UpdateStatus`

### 4.3 실제 블록 생성 검증 (30분)

**검증 방법:**
```bash
# 블록 높이 확인
docker exec cli peer channel getinfo -c newportchannel

# 트랜잭션 전후 블록 높이 비교
# 1. 트랜잭션 전 블록 높이 기록
# 2. API를 통한 트랜잭션 실행
# 3. 트랜잭션 후 블록 높이 확인 (증가해야 함)
```

## 🧪 5단계: 통합 테스트 (2시간)

### 5.1 시나리오 기반 테스트 (1시간)

**시나리오 1: 컨테이너 생명주기 관리**
```bash
# 1. 컨테이너 등록
curl -X POST http://localhost:3000/api/containers \
  -H "Content-Type: application/json" \
  -H "X-API-Key: kuls-api-key-2025" \
  -d '{
    "containerID": "FULL-TEST-001",
    "vesselName": "INTEGRATION_VESSEL",
    "voyage": "INT001E",
    "size": "40FT",
    "type": "DRY",
    "owner": "IntegrationTest"
  }'

# 2. 컨테이너 조회
curl -X GET http://localhost:3000/api/containers/FULL-TEST-001 \
  -H "X-API-Key: kuls-api-key-2025"

# 3. 위치 업데이트
curl -X PATCH http://localhost:3000/api/containers/FULL-TEST-001/location \
  -H "Content-Type: application/json" \
  -H "X-API-Key: kuls-api-key-2025" \
  -d '{
    "location": "CFS1-A20",
    "operator": "API_TEST",
    "status": "LOADING",
    "remarks": "API 통합 테스트"
  }'

# 4. 상태 업데이트
curl -X PATCH http://localhost:3000/api/containers/FULL-TEST-001/status \
  -H "Content-Type: application/json" \
  -H "X-API-Key: kuls-api-key-2025" \
  -d '{
    "status": "LOADED",
    "operator": "API_TEST",
    "remarks": "로딩 완료"
  }'
```

### 5.2 성능 및 안정성 테스트 (1시간)

**부하 테스트:**
```bash
# 동시 요청 처리 테스트
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/containers \
    -H "Content-Type: application/json" \
    -H "X-API-Key: kuls-api-key-2025" \
    -d "{
      \"containerID\": \"LOAD-TEST-$(printf %03d $i)\",
      \"vesselName\": \"LOAD_VESSEL\",
      \"voyage\": \"LOAD001E\",
      \"size\": \"20FT\",
      \"type\": \"DRY\",
      \"owner\": \"LoadTest\"
    }" &
done
wait
```

## 🔧 6단계: 운영 환경 준비 (1시간)

### 6.1 환경별 설정 분리 (30분)

**파일 구조:**
```
config/
├── connection-profile.json          # 개발 환경
├── connection-profile.prod.json     # 운영 환경
├── development-guide.md
└── github-config.json
```

### 6.2 로깅 및 모니터링 설정 (30분)

**로그 파일 확인:**
```bash
tail -f /home/minsujo/inje-api-gateway/logs/fabric.log
tail -f /home/minsujo/inje-api-gateway/logs/app.log
```

## 📋 7단계: 문서화 및 배포 (1시간)

### 7.1 API 문서 업데이트 (30분)

**업데이트할 파일:**
- `/home/minsujo/inje-api-gateway/README.md`
- Postman Collection 업데이트

### 7.2 배포 스크립트 준비 (30분)

**배포 체크리스트:**
```bash
# 1. 환경 변수 확인
npm run config:verify

# 2. 의존성 설치 확인
npm ci

# 3. 빌드 테스트
npm run build

# 4. 테스트 실행
npm test

# 5. 서비스 시작
npm run start:prod
```

## ⚠️ 주의사항 및 롤백 계획

### 주의사항
1. **LevelDB 제한사항:** `GetAllContainers` 함수는 CouchDB가 아닌 LevelDB에서는 작동하지 않음
2. **체인코드 함수명:** 정확히 매칭되어야 함 (대소문자 구분)
3. **네트워크 타임아웃:** 블록체인 응답 시간을 고려한 타임아웃 설정 필요

### 롤백 계획
1. **환경 변수 롤백:**
   ```bash
   cp .env.backup.YYYYMMDD_HHMMSS .env
   ```

2. **서비스 재시작:**
   ```bash
   npm run restart
   ```

3. **Mock 모드 복구:**
   ```bash
   export NODE_ENV=development
   npm run dev
   ```

## 📈 예상 소요 시간

| 단계 | 내용 | 소요 시간 | 누적 시간 |
|------|------|-----------|-----------|
| 1단계 | 환경 설정 및 연결 구성 | 2시간 | 2시간 |
| 2단계 | API Gateway 서비스 수정 | 3시간 | 5시간 |
| 3단계 | 체인코드 호환성 테스트 | 2시간 | 7시간 |
| 4단계 | 실제 연동 구현 | 4시간 | 11시간 |
| 5단계 | 통합 테스트 | 2시간 | 13시간 |
| 6단계 | 운영 환경 준비 | 1시간 | 14시간 |
| 7단계 | 문서화 및 배포 | 1시간 | 15시간 |

**총 예상 소요 시간: 15시간 (2-3일 작업 기준)**

## 🎯 성공 기준

1. ✅ **기능적 성공:**
   - 외부 클라이언트가 API Gateway를 통해 체인코드 함수 호출 가능
   - 실제 블록 생성 확인 (블록 높이 증가)
   - 모든 CRUD 작업이 블록체인에 기록됨

2. ✅ **기술적 성공:**
   - API 응답 시간 < 5초
   - 에러율 < 1%
   - 동시 요청 처리 가능 (최소 10개)

3. ✅ **운영적 성공:**
   - 로그 기록 정상 작동
   - 모니터링 대시보드 연동
   - 문서화 완료

이 계획서를 따라 단계별로 구현하면 INJE API Gateway가 실제 Hyperledger Fabric 블록체인 네트워크와 완전히 연동되어 외부 클라이언트가 실제 블록을 생성할 수 있게 됩니다.