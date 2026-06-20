# ---------- Builder: cài dependencies (có sẵn build tools cho better-sqlite3) ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# ---------- Runtime: image gọn để chạy ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app /app
# Thư mục dữ liệu (DB + ảnh) - sẽ được mount volume ./data khi chạy.
# Chạy bằng root để luôn ghi được vào volume bind-mount (./data trên host
# thường thuộc quyền root → user thường sẽ bị EACCES khi mkdir).
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
