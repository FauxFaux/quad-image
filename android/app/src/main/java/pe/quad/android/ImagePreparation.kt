package pe.quad.android

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream
import java.io.InputStream

private enum class SourceFormat(val mime: String, val extension: String) {
    GIF("image/gif", "gif"),
    PNG("image/png", "png"),
    JPEG("image/jpeg", "jpg"),
    WEBP("image/webp", "webp"),
    OTHER("application/octet-stream", "bin"),
}

internal fun prepareImage(resolver: ContentResolver, uri: Uri): PreparedImage {
    val original = resolver.openInputStream(uri)?.use { it.readPrefix(MAX_IMAGE_BYTES + 1) }
        ?: throw UploadFailure("Cannot open shared image")
    val format = detectFormat(original)
    if (format == SourceFormat.GIF) {
        if (original.size > MAX_IMAGE_BYTES) throw UploadFailure("Animated GIF exceeds the upload limit")
        return PreparedImage(original, format.mime, "image.gif")
    }
    if (Build.VERSION.SDK_INT < 28 && format in listOf(SourceFormat.JPEG, SourceFormat.WEBP)) {
        if (original.size > MAX_IMAGE_BYTES) throw UploadFailure("Image exceeds the upload limit")
        // These formats may contain EXIF orientation. Keep the metadata on older Android versions.
        return PreparedImage(original, format.mime, "image.${format.extension}")
    }

    val bitmap = decodeImage(resolver, uri)
    try {
        val candidate = if (format == SourceFormat.PNG && Build.VERSION.SDK_INT >= 30) {
            encode(bitmap, Bitmap.CompressFormat.WEBP_LOSSLESS, 100).takeIf { it.size <= 1024 * 1024 }
                ?: encodeLossy(bitmap)
        } else if (format == SourceFormat.PNG && original.size <= MAX_IMAGE_BYTES) {
            // Lossless WebP is unavailable on API 25–29; keep small PNGs intact.
            if (original.size <= 1024 * 1024) null else encodeLossy(bitmap)
        } else encodeLossy(bitmap)

        if (candidate != null && candidate.size <= MAX_IMAGE_BYTES &&
            (original.size > MAX_IMAGE_BYTES || candidate.size < original.size * 0.9)
        ) {
            return PreparedImage(candidate, "image/webp", "image.webp")
        }
        if (original.size <= MAX_IMAGE_BYTES && format != SourceFormat.OTHER) {
            return PreparedImage(original, format.mime, "image.${format.extension}")
        }
        throw UploadFailure("Image cannot be reduced below the upload limit")
    } finally {
        bitmap.recycle()
    }
}

private fun detectFormat(bytes: ByteArray): SourceFormat = when {
    bytes.size >= 6 && (bytes.copyOfRange(0, 6).contentEquals("GIF87a".toByteArray()) ||
        bytes.copyOfRange(0, 6).contentEquals("GIF89a".toByteArray())) -> SourceFormat.GIF
    bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(
        byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)) -> SourceFormat.PNG
    bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() &&
        bytes[2] == 0xFF.toByte() -> SourceFormat.JPEG
    bytes.size >= 12 && bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray()) &&
        bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray()) -> SourceFormat.WEBP
    else -> SourceFormat.OTHER
}

private fun decodeImage(resolver: ContentResolver, uri: Uri): Bitmap {
    if (Build.VERSION.SDK_INT >= 28) {
        try {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                val width = info.size.width
                val height = info.size.height
                if (width <= 0 || height <= 0) throw UploadFailure("Invalid image dimensions")
                val scale = minOf(1.0, 4096.0 / maxOf(width, height))
                decoder.setTargetSize(maxOf(1, (width * scale).toInt()), maxOf(1, (height * scale).toInt()))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } catch (error: Exception) {
            throw UploadFailure("Cannot decode image: ${error.message ?: "unsupported format"}")
        }
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw UploadFailure("Cannot decode image")
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw UploadFailure("Cannot decode image")
}

private fun encodeLossy(bitmap: Bitmap): ByteArray {
    val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else {
        @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    }
    var bytes = encode(bitmap, format, 80)
    if (bytes.size > 5 * 1024 * 1024) bytes = encode(bitmap, format, 50)
    if (bytes.size > MAX_IMAGE_BYTES) bytes = encode(bitmap, format, 20)
    return bytes
}

private fun encode(bitmap: Bitmap, format: Bitmap.CompressFormat, quality: Int): ByteArray {
    val output = ByteArrayOutputStream()
    if (!bitmap.compress(format, quality, output)) throw UploadFailure("Image encoding failed")
    return output.toByteArray()
}

private fun InputStream.readPrefix(maxBytes: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (output.size() < maxBytes) {
        val count = read(buffer, 0, minOf(buffer.size, maxBytes - output.size()))
        if (count < 0) break
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
