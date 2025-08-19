# ---------- base (có toolchain) ----------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat

# ---------- deps: cài full deps để build nếu cần ----------
FROM base AS deps
# manifest ở ROOT của repo vì context là "."
COPY package.json package-lock.json* yarn.lock* .npmrc* ./
# cài deps linh hoạt + fallback
RUN if [ -f yarn.lock ]; then \
    corepack enable && yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
    npm ci || npm install; \
    else \
    npm install; \
    fi

# copy code backend vào /app/backend
COPY backend/ ./backend

# build nếu có script "build" (Nest/TS), không có thì bỏ qua
RUN if npm run | grep -q "build"; then npm run build; else echo "no build step"; fi

# ---------- runtime: chỉ prod deps ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production

# cài prod deps gọn
COPY package.json package-lock.json* yarn.lock* .npmrc* ./
RUN if [ -f yarn.lock ]; then \
    corepack enable && yarn install --production --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
    npm ci --omit=dev || npm install --omit=dev; \
    else \
    npm install --omit=dev; \
    fi

# copy artifact đã build (nếu có) + mã nguồn backend
# nếu app chạy từ dist (Nest), ưu tiên dist
COPY --from=deps /app/dist ./dist  2>/dev/null || true
COPY backend/ ./backend

EXPOSE 3000
# ⚠️ Đổi theo script thật trong package.json (server/start/start:prod)
CMD ["npm","run","server"]
