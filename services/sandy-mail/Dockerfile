FROM golang:1.27.3-bookworm@sha256:972b4110ba0f47539a975c31e52c64765e1ff19f2d74469ae4a595c6676e80a5 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /mail-fixture ./cmd/mail-fixture
FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /mail-fixture /mail-fixture
USER 65532:65532
ENTRYPOINT ["/mail-fixture"]
