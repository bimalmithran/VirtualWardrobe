# Multi-stage build. The API links ONNX Runtime through cgo for cloud vision (background
# removal and style vectors for phones too weak to run them), so it ships on Debian slim
# with the ORT shared library rather than on a static distroless image.

FROM debian:bookworm-slim AS ort
# Must match the C API version onnxruntime_go was built against (see its README).
ARG ORT_VERSION=1.29.0
ARG TARGETARCH
ADD https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-x64-${ORT_VERSION}.tgz /tmp/ort-amd64.tgz
ADD https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-aarch64-${ORT_VERSION}.tgz /tmp/ort-arm64.tgz
RUN mkdir -p /ort && tar -xzf /tmp/ort-${TARGETARCH:-amd64}.tgz -C /ort --strip-components=1 \
 && cp -P /ort/lib/libonnxruntime.so* /usr/local/lib/

FROM golang:1.27-bookworm AS build
WORKDIR /src
# Dependencies first so code edits don't invalidate the module cache layer.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go vet ./... \
 && go test ./... \
 && CGO_ENABLED=1 go build -tags onnx -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && mkdir -p /out/data/uploads /out/data/models

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 65532 --no-create-home nonroot
COPY --from=ort /usr/local/lib/libonnxruntime.so* /usr/local/lib/
RUN ldconfig
COPY --from=build /out/server /server
# Owned by the nonroot user so named volumes mounted here inherit writable perms.
COPY --from=build --chown=65532:65532 /out/data /data
ENV ADDR=:8080 UPLOAD_DIR=/data/uploads VISION_MODELS_DIR=/data/models ORT_LIB_PATH=/usr/local/lib/libonnxruntime.so
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/server"]
