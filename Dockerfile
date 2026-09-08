# Build once on a connected network. Runtime assets are bundled; only explicitly
# configured integrations need access to their administrator-approved endpoints.
FROM node:22-alpine AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26.8-alpine AS server
WORKDIR /build
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
COPY --from=web /build/web/dist ./web/dist
ARG VERSION
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    MADI_VERSION="${VERSION:-$(tr -d '\r\n' < VERSION)}" && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X main.version=${MADI_VERSION}" -o /out/madi ./cmd/madi

FROM alpine:3.22
LABEL org.opencontainers.image.title="madi" \
      org.opencontainers.image.source="https://github.com/hkjang/madi" \
      org.opencontainers.image.description="Self-hosted Korean knowledge and AI workspace"
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -g 10001 madi && adduser -D -H -u 10001 -G madi madi && \
    mkdir -p /var/lib/madi/attachments && chown -R madi:madi /var/lib/madi
COPY --from=server /out/madi /usr/local/bin/madi
USER 10001:10001
WORKDIR /var/lib/madi
EXPOSE 8080
VOLUME ["/var/lib/madi"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/madi"]
