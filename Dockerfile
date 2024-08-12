# syntax=docker/dockerfile:1

FROM clux/muslrust:stable AS build-rust

# download the index
RUN cargo search lazy_static
RUN cargo install cargo-auditable
ADD Cargo.* ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo fetch
ENV CARGO_PROFILE_RELEASE_LTO=true
ADD . .
RUN cargo auditable build --release


FROM node:20-alpine AS build-js
# this is for `npm:canvas`, which is only loaded in tests (and doeesn't even work)
RUN apk add --no-cache python3 make cairo-dev pango-dev g++ jpeg librsvg-dev
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
