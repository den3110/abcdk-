# ---------- base ----------
FROM node:20-alpine AS base
WORKDIR /app
# Toolchain cho native deps (bcrypt, sharp, canvas, …) + compat
RUN apk add --no-cache python3 make g++ libc6-compat
ENV NODE_ENV=development

# ---------- deps (cài đủ để build) ----------
FROM base AS deps
WORKDIR /app
# Kéo .npmrc nếu bạn dùng private registry
COPY package.json package-lock.json* yarn.lock* .npmrc* ./
# npm/yarn linh hoạt + fallback nếu thiếu lockfile
RUN if [ -f yarn.lock ]; then \
      corepack enable && yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci || npm install; \
    else \
      npm install; \
    fi

# ---------- build (nếu có) ----------
FROM deps AS build
WORKDIR /app
COPY . .
# Nếu có script build (Nest/TS) thì chạy, không có thì bỏ qua
RUN if npm run | grep -q "build"; then npm run build; else echo "no build step"; fi

# ---------- runtime (chỉ prod deps) ----------
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production

# Cài **prod deps** gọn nhẹ
COPY package.json package-lock.json* yarn.lock* .npmrc* ./
RUN if [ -f yarn.lock ]; then \
      corepack enable && yarn install --production --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci --omit=dev || npm install --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# Copy artifact build (nếu có) và các file cần để chạy
COPY --from=build /app/dist ./dist
COPY . .  # nếu app chạy từ dist thì phần src không ảnh hưởng

# ⚠️ GIỮ cổng 3000 trong container để khớp compose (map ra 5000 cho Nginx)
EXPOSE 3000
# Đổi theo script thực tế của bạn: "start:prod" / "start" / "server"
CMD ["npm","run","start:prod"]
