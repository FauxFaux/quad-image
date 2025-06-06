# syntax=docker/dockerfile:1

FROM clux/muslrust:stable AS build-rust

# download the index
RUN cargo search rand
RUN cargo install cargo-auditable
ADD Cargo.* ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo fetch
ENV CARGO_PROFILE_RELEASE_LTO=true
ADD . .
RUN cargo auditable build --release


FROM node:22-alpine AS build-js
WORKDIR /volume
ADD package.json package-lock.json ./
RUN npm ci
ADD . .
RUN npm run build


FROM alpine:3
RUN apk add --no-cache dumb-init
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
USER 65534

COPY --from=build-rust /volume/target/x86_64-unknown-linux-musl/release/quad-image /opt
COPY --from=build-js /volume/dist /opt/dist

VOLUME ["/data"]
WORKDIR /data

ENV BIND_ADDR=0.0.0.0:80
ENV FRONTEND_DIR=/opt/dist
EXPOSE 80
CMD ["/opt/quad-image"]
