FROM golang:1.25-alpine AS build
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src/observer-vps

COPY observer-vps/go.mod observer-vps/go.sum ./
RUN go mod download

COPY observer-vps/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/pickletour-observer ./cmd/observer

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -H -u 10001 observer

WORKDIR /app
COPY --from=build /out/pickletour-observer /usr/local/bin/pickletour-observer

ENV NODE_ENV=production
ENV OBSERVER_PORT=8787
EXPOSE 8787

USER observer
ENTRYPOINT ["/usr/local/bin/pickletour-observer"]
