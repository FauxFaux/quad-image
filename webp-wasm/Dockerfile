# syntax=docker/dockerfile:1

ARG EMSDK_VERSION=6.0.9
FROM emscripten/emsdk:${EMSDK_VERSION} AS build

ARG LIBWEBP_TAG=v1.6.0

WORKDIR /src

RUN git clone --depth 1 --branch "${LIBWEBP_TAG}" --single-branch \
      https://github.com/webmproject/libwebp.git libwebp \
 && test "$(git -C libwebp describe --exact-match --tags)" = "${LIBWEBP_TAG}"

RUN set -eux; \
    common_cmake_args='-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_DISABLE_FIND_PACKAGE_Threads=TRUE -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF'; \
    emcmake cmake -S libwebp -B /build/baseline ${common_cmake_args} -DWEBP_ENABLE_SIMD=OFF; \
    cmake --build /build/baseline --parallel; \
    mkdir -p /out; \
    emcc /build/baseline/libwebp.a /build/baseline/libsharpyuv.a -O3 --no-entry \
      -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 \
      -s EXPORTED_FUNCTIONS='["_WebPEncodeRGBA","_WebPFree","_malloc","_free"]' \
      -o /out/webp-encode.wasm

RUN set -eux; \
    mkdir -p /out/include /out/baseline/lib; \
    cp -a libwebp/src/webp /out/include/; \
    find /build/baseline -type f -name '*.a' -exec cp -t /out/baseline/lib {} +; \
    printf '%s\\n' "${LIBWEBP_TAG}" > /out/LIBWEBP_TAG

FROM scratch AS wasm
COPY --from=build /out/webp-encode.wasm /webp-encode.wasm
