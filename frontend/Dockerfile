# ---------- build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# toolchain phòng khi có native deps
RUN apk add --no-cache python3 make g++

# copy manifest để cache layer cài deps
COPY package.json package-lock.json* yarn.lock* ./

# cài deps: ưu tiên npm ci nếu có lock, fallback yarn hoặc npm install
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    elif [ -f yarn.lock ]; then \
      corepack enable && yarn install --frozen-lockfile; \
    else \
      npm install; \
    fi

# copy source & build (Vite -> dist/)
COPY . .
ENV NODE_OPTIONS=--max_old_space_size=2048
# tự động chọn npm run build hoặc yarn build
RUN if [ -f package-lock.json ]; then \
      npm run build; \
    else \
      corepack enable && yarn build; \
    fi

# ---------- artifact stage ----------
FROM alpine:3.19
WORKDIR /app_build
# Vite output là dist/
COPY --from=build /app/dist ./
CMD ["sh","-c","while :; do sleep 3600; done"]
