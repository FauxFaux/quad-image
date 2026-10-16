// Lossless encoding with optional near-lossless pixel preprocessing.
#include <webp/encode.h>

size_t WebPEncodeRGBAWithNearLossless(const uint8_t* rgba, int width, int height,
                                     int stride, int near_lossless,
                                     uint8_t** output) {
  WebPConfig config;
  WebPPicture picture;
  WebPMemoryWriter writer;
  int ok;

  if (output == NULL) return 0;
  *output = NULL;
  // Match WebPEncodeLosslessRGBA's preset and RGBA import behavior.
  if (!WebPConfigPreset(&config, WEBP_PRESET_DEFAULT, 70.f)) return 0;
  config.lossless = 1;
  config.near_lossless = near_lossless;
  if (!WebPValidateConfig(&config) || !WebPPictureInit(&picture)) return 0;

  picture.use_argb = 1;
  picture.width = width;
  picture.height = height;
  picture.writer = WebPMemoryWrite;
  picture.custom_ptr = &writer;
  WebPMemoryWriterInit(&writer);
  ok = WebPPictureImportRGBA(&picture, rgba, stride) &&
       WebPEncode(&config, &picture);
  WebPPictureFree(&picture);
  if (!ok) {
    WebPMemoryWriterClear(&writer);
    return 0;
  }
  // Ownership passes to the caller, which releases it with WebPFree.
  *output = writer.mem;
  return writer.size;
}
