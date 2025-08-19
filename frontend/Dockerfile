FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_OPTIONS=--max_old_space_size=2048
RUN yarn build

FROM alpine:3.19
# copy build ra /app_build (không chạy web server)
WORKDIR /app_build
COPY --from=build /app/build ./
CMD ["sh","-c","while :; do sleep 3600; done"]
