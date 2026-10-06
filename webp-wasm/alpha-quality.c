// A lossy entry point with independent alpha quality. The upstream convenience
// API always uses lossless alpha (quality 100). Keep its preset/import behavior.
#include <webp/encode.h>

size_t WebPEncodeRGBAWithAlphaQuality(const uint8_t* rgba, int width, int height,
                                     int stride, float quality, int alpha_quality,
                                     uint8_t** output) {
  WebPConfig config;
  WebPPicture picture;
  WebPMemoryWriter writer;
  int ok;

  if (output == NULL) return 0;
  *output = NULL;
  if (!WebPConfigPreset(&config, WEBP_PRESET_DEFAULT, quality)) return 0;
  config.alpha_quality = alpha_quality;
  if (!WebPValidateConfig(&config) || !WebPPictureInit(&picture)) return 0;

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
