# Build stages run on the build machine's own platform. Only the final image
# is per target platform, so multi-arch builds do not need emulation.

# Build the React frontend. The output is static files, the same for every platform.
FROM --platform=$BUILDPLATFORM node:26-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Cross compile the Go API as a static binary for the target platform.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /out/server ./cmd/server

# Runtime image: the Go server serves both the API and the built frontend.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /out/server /app/server
COPY --from=frontend /app/dist /app/static
ENV PORT=8080 \
    STATIC_DIR=/app/static \
    SHUTDOWN_DRAIN_DELAY=5s
EXPOSE 8080
USER nonroot:nonroot
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 CMD ["/app/server", "-healthcheck"]
ENTRYPOINT ["/app/server"]
