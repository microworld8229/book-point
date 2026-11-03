# 책읽는 장병 - 운영 이미지 (Render·Fly.io·Railway 등 Docker 지원 플랫폼 공통)
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# DB는 영구 디스크(/data)에 저장 — 플랫폼에서 볼륨을 /data 에 연결해야 재배포 후에도 데이터가 남는다
# (플랫폼이 붙이는 볼륨은 root 소유라 별도 사용자로 바꾸지 않는다)
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]
