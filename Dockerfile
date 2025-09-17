# Node.js 기본 이미지
FROM node:18-alpine as base

# 작업 디렉토리 설정
WORKDIR /app

# 패키지 파일 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# 소스 코드 복사
COPY . .

# TypeScript 컴파일
RUN npm run build

# 포트 노출
EXPOSE 3000

# 앱 실행
CMD ["npm", "start"]

# 개발용 이미지
FROM base as development

WORKDIR /app

# 모든 의존성 설치 (개발 도구 포함)
RUN npm ci

# nodemon으로 개발 서버 실행
CMD ["npm", "run", "dev"]
