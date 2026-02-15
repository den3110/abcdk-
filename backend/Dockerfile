# --- Backend (Express) ---
FROM node:20-alpine
WORKDIR /app

# toolchain cho native deps nếu có (bcrypt/sharp/...)
# toolchain cho native deps nếu có (bcrypt/sharp/...)
RUN apk add --no-cache \
  python3 \
  make \
  g++ \
  libc6-compat \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

# Puppeteer config for Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# manifest nằm ở ROOT repo (vì context = ".")
COPY package.json package-lock.json* yarn.lock* .npmrc* ./

# cài deps (ưu tiên lockfile, fallback nếu thiếu)
RUN if [ -f yarn.lock ]; then \
  corepack enable && yarn install --production --frozen-lockfile; \
  elif [ -f package-lock.json ]; then \
  npm ci --omit=dev || npm install --omit=dev; \
  else \
  npm install --omit=dev; \
  fi

# copy mã nguồn backend
COPY backend/ ./backend

ENV NODE_ENV=production
# Container nghe 3000; Nginx proxy host:5000 sẽ map qua compose
ENV PORT=3000
EXPOSE 3000

# chạy trực tiếp server.js
CMD ["node","backend/server.js"]
