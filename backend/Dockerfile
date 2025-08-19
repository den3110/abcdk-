FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
# Ví dụ Nest/Express lắng nghe 3000
EXPOSE 3000
CMD ["npm","run","server"]   # hoặc "start:prod" tuỳ dự án bạn