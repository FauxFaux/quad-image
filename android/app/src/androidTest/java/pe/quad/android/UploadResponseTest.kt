package pe.quad.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UploadResponseTest {
    @Test fun acceptsImageResource() {
        assertEquals("e/Abc123xyz0.webp",
            parseUploadResponse("""{"data":{"id":"e/Abc123xyz0.webp","type":"image"}}"""))
    }

    @Test fun rejectsWrongTypeOrUnsafeId() {
        listOf(
            """{"data":{"id":"e/Abc123xyz0.webp","type":"gallery"}}""",
            """{"data":{"id":"../secrets.jpg","type":"image"}}""",
            """{"data":{"id":"https://evil.example/a.jpg","type":"image"}}""",
            """{"errors":[{"title":"bad image"}]}""",
        ).forEach { body ->
            assertThrows(UploadFailure::class.java) { parseUploadResponse(body) }
        }
    }
}
