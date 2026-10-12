# Multi-stage build: compile a static binary, ship it on distroless (~15 MB image).
FROM golang:1.25-alpine AS build
WORKDIR /src

# Dependencies first so code edits don't invalidate the module cache layer.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go vet ./... \
 && go test ./... \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && mkdir -p /out/data/uploads

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
# Owned by the nonroot user so the named volume mounted here inherits writable perms.
COPY --from=build --chown=65532:65532 /out/data /data
ENV ADDR=:8080 UPLOAD_DIR=/data/uploads
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/server"]
