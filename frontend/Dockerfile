# ---------- build deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Toolchain cho native deps + compat glibc (một số lib cần)
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy manifest (kéo .npmrc nếu dùng private registry)
COPY package.json package-lock.json* yarn.lock* .npmrc* ./

# Cài deps:
# - Nếu có yarn.lock → dùng yarn (Corepack)
# - Nếu có package-lock.json → ưu tiên npm ci, nếu fail fallback npm install
# - Nếu không có lock → npm install
RUN if [ -f yarn.lock ]; then \
      corepack enable && yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then \
      npm ci || npm install; \
    else \
      npm install; \
    fi

# ---------- build ----------
FROM deps AS build
# Copy source & build (Vite -> dist/)
COPY . .
ENV NODE_OPTIONS=--max_old_space_size=2048
RUN if [ -f yarn.lock ]; then \
      corepack enable && yarn build; \
    else \
      npm run build; \
    fi

# ---------- artifact stage ----------
FROM alpine:3.19
WORKDIR /app_build
# Vite output là dist/
COPY --from=build /app/dist ./
CMD ["sh","-c","while :; do sleep 3600; done"]
