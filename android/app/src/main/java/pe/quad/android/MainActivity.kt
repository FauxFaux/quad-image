package pe.quad.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import pe.quad.android.ui.theme.QuadTheme
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

internal data class UploadRow(
    val key: String = UUID.randomUUID().toString(),
    val source: Uri? = null,
    val origin: String? = null,
    val imageId: String? = null,
    val response: String = "",
    val status: String = "Waiting to upload",
    val busy: Boolean = false,
)

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("quad", MODE_PRIVATE) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val uploadMutex = Mutex()
    private val rows = mutableStateListOf<UploadRow>()
    private var baseUrl by mutableStateOf("")
    private val pickImages = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { enqueue(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        baseUrl = preferences.getString("base_url", "") ?: ""
        rows.addAll(ResultStore.load(preferences))
        handleShare(intent)
        setContent {
            QuadTheme {
                Scaffold { padding ->
                    UploadScreen(
                        baseUrl = baseUrl,
                        onBaseUrlChange = { value ->
                            baseUrl = value
                            preferences.edit().putString("base_url", value).apply()
                            uploadWaiting()
                        },
                        onPick = { pickImages.launch("image/*") },
                        rows = rows,
                        onCopy = { url ->
                            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Image URL", url))
                        },
                        onRetry = { key ->
                            update(key) { it.copy(status = "Waiting to upload", response = "") }
                            uploadWaiting()
                        },
                        modifier = Modifier.padding(padding),
                    )
                }
            }
        }
        uploadWaiting()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleShare(intent)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun handleShare(intent: Intent?) {
        if (intent == null || intent.type?.startsWith("image/") != true) return
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(intent.sharedUri())
            Intent.ACTION_SEND_MULTIPLE -> intent.sharedUris()
            else -> emptyList()
        }
        enqueue(uris)
    }

    private fun enqueue(uris: List<Uri>) {
        uris.distinct().forEach { rows.add(0, UploadRow(source = it)) }
        uploadWaiting()
    }

    private fun uploadWaiting() {
        val origin = try { serverOrigin(baseUrl) } catch (_: IllegalArgumentException) { return }
        rows.filter { it.source != null && !it.busy && it.status == "Waiting to upload" }.forEach { row ->
            update(row.key) { it.copy(status = "Queued", busy = true) }
            scope.launch {
                uploadMutex.withLock {
                    update(row.key) { it.copy(status = "Preparing and uploading…") }
                    val outcome = withContext(Dispatchers.IO) {
                        try {
                            val image = prepareImage(contentResolver, row.source!!)
                            val result = uploadImage(origin, image)
                            UploadRow(key = row.key, origin = origin, imageId = result.id,
                                response = result.body, status = "Uploaded")
                        } catch (error: Exception) {
                            UploadRow(key = row.key, source = row.source,
                                response = (error as? UploadFailure)?.body.orEmpty(),
                                status = error.message ?: "Upload failed")
                        }
                    }
                    update(row.key) { outcome }
                    if (outcome.imageId != null) ResultStore.save(preferences, rows)
                }
            }
        }
    }

    private fun update(key: String, transform: (UploadRow) -> UploadRow) {
        val index = rows.indexOfFirst { it.key == key }
        if (index >= 0) rows[index] = transform(rows[index])
    }
}

private fun Intent.sharedUri(): Uri? =
    if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else {
        @Suppress("DEPRECATION") getParcelableExtra(Intent.EXTRA_STREAM)
    }

private fun Intent.sharedUris(): List<Uri> =
    if (Build.VERSION.SDK_INT >= 33) getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty() else {
        @Suppress("DEPRECATION") getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
    }

@Composable
private fun UploadScreen(
    baseUrl: String,
    onBaseUrlChange: (String) -> Unit,
    onPick: () -> Unit,
    rows: List<UploadRow>,
    onCopy: (String) -> Unit,
    onRetry: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val valid = try { serverOrigin(baseUrl); true } catch (_: IllegalArgumentException) { false }
    Column(modifier = modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Quad Image", style = MaterialTheme.typography.headlineMedium)
        OutlinedTextField(
            value = baseUrl, onValueChange = onBaseUrlChange,
            label = { Text("Server base URL") },
            placeholder = { Text("https://images.example.com") },
            supportingText = { if (!valid) Text("Enter a full http or https server URL") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
        )
        Button(onClick = onPick) { Text("Choose images") }
        Text("Uploads", style = MaterialTheme.typography.titleLarge)
        if (rows.isEmpty()) Text("Choose images or share photos here from another app.")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(rows, key = { it.key }) { row ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val imageUrl = row.imageId?.let { id -> "${row.origin}/$id" }
                        if (imageUrl != null) {
                            Thumbnail("$imageUrl.thumb.jpg")
                            Text(imageUrl, style = MaterialTheme.typography.bodyMedium)
                            Button(onClick = { onCopy(imageUrl) }) { Text("Copy URL") }
                        } else if (row.busy) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp))
                                Text(row.status)
                            }
                        } else {
                            Text(row.status)
                            if (row.source != null && row.status != "Waiting to upload") {
                                Button(onClick = { onRetry(row.key) }) { Text("Retry") }
                            }
                        }
                        if (row.response.isNotBlank()) Text(row.response, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun Thumbnail(url: String) {
    val bitmap by produceState<Bitmap?>(initialValue = null, url) {
        value = withContext(Dispatchers.IO) {
            try {
                val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10_000
                    readTimeout = 10_000
                }
                try {
                    if (connection.responseCode != 200) null else
                        connection.inputStream.use { BitmapFactory.decodeStream(it) }
                } finally { connection.disconnect() }
            } catch (_: Exception) { null }
        }
    }
    if (bitmap != null) {
        Image(bitmap!!.asImageBitmap(), contentDescription = "Uploaded image preview",
            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(180.dp))
    } else Text("Preview unavailable", style = MaterialTheme.typography.bodySmall)
}
