package pe.quad.android

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

internal const val MAX_IMAGE_BYTES = 9 * 1024 * 1024
private val imageIdPattern = Regex("e/[A-Za-z0-9]{10}\\.(?:png|webp|jpg|gif)")

internal data class PreparedImage(val bytes: ByteArray, val mimeType: String, val fileName: String)
internal data class UploadResult(val id: String, val body: String)
internal class UploadFailure(message: String, val body: String = "") : Exception(message)

internal fun serverOrigin(input: String): String {
    val uri = try { URI(input.trim()) } catch (_: Exception) { throw IllegalArgumentException("Invalid server URL") }
    require(uri.scheme == "https" || uri.scheme == "http") { "Use an http or https URL" }
    require(!uri.host.isNullOrBlank() && uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
        "Enter a server origin"
    }
    require(uri.path.isNullOrEmpty() || uri.path == "/") { "Enter a server origin without a path" }
    require(uri.port in -1..65535 && uri.port != 0) { "Invalid server port" }
    return "${uri.scheme}://${uri.rawAuthority}".trimEnd('/')
}

internal fun parseUploadResponse(body: String): String {
    val data = try { JSONObject(body).getJSONObject("data") }
        catch (_: Exception) { throw UploadFailure("Invalid upload response", body) }
    val id = data.optString("id")
    if (data.optString("type") != "image" || !imageIdPattern.matches(id)) {
        throw UploadFailure("Invalid image ID in response", body)
    }
    return id
}

internal fun uploadImage(origin: String, image: PreparedImage): UploadResult {
    val boundary = "quad-${UUID.randomUUID()}"
    val prefix = ("--$boundary\r\n" +
        "Content-Disposition: form-data; name=\"return_json\"\r\n\r\ntrue\r\n" +
        "--$boundary\r\n" +
        "Content-Disposition: form-data; name=\"image\"; filename=\"${image.fileName}\"\r\n" +
        "Content-Type: ${image.mimeType}\r\n\r\n").toByteArray(StandardCharsets.UTF_8)
    val suffix = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
    require(prefix.size + image.bytes.size + suffix.size < 10 * 1024 * 1024) { "Image exceeds server upload limit" }
    val connection = (URL("$origin/api/upload").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 60_000
        doOutput = true
        setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        setFixedLengthStreamingMode(prefix.size + image.bytes.size + suffix.size)
    }
    try {
        connection.outputStream.use {
            it.write(prefix)
            it.write(image.bytes)
            it.write(suffix)
        }
        val status = connection.responseCode
        val stream = if (status == 200) connection.inputStream else connection.errorStream
        val body = stream?.use { it.readBounded(64 * 1024).toString(StandardCharsets.UTF_8) }.orEmpty()
        if (status != 200) {
            val title = try {
                JSONObject(body).getJSONArray("errors").getJSONObject(0).optString("title")
            } catch (_: Exception) { "" }
            throw UploadFailure("HTTP $status: ${title.ifBlank { connection.responseMessage ?: "Upload failed" }}", body)
        }
        val mediaType = connection.contentType?.substringBefore(';')?.trim()
        if (mediaType != "application/vnd.api+json") throw UploadFailure("Unexpected response type", body)
        return UploadResult(parseUploadResponse(body), body)
    } finally {
        connection.disconnect()
    }
}

internal fun java.io.InputStream.readBounded(maxBytes: Int): ByteArray {
    val result = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (true) {
        val count = read(buffer, 0, minOf(buffer.size, maxBytes + 1 - result.size()))
        if (count < 0) break
        result.write(buffer, 0, count)
        if (result.size() > maxBytes) throw UploadFailure("Image or response is too large")
    }
    return result.toByteArray()
}

internal object ResultStore {
    fun load(preferences: SharedPreferences): List<UploadRow> = try {
        val data = JSONArray(preferences.getString("results", "[]"))
        (0 until data.length()).mapNotNull { index ->
            val item = data.getJSONObject(index)
            val origin = serverOrigin(item.getString("origin"))
            val id = item.getString("id")
            if (!imageIdPattern.matches(id)) null else UploadRow(
                origin = origin, imageId = id, response = item.optString("response"), status = "Uploaded")
        }
    } catch (_: Exception) { emptyList() }

    fun save(preferences: SharedPreferences, rows: List<UploadRow>) {
        val data = JSONArray()
        rows.filter { it.imageId != null && it.origin != null }.forEach { row ->
            data.put(JSONObject().put("origin", row.origin).put("id", row.imageId).put("response", row.response))
        }
        preferences.edit().putString("results", data.toString()).apply()
    }
}
