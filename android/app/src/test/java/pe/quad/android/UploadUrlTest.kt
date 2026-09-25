package pe.quad.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class UploadUrlTest {
    @Test fun acceptsServerOrigins() {
        assertEquals("https://images.example.com", serverOrigin(" https://images.example.com/ "))
        assertEquals("http://localhost:8080", serverOrigin("http://localhost:8080"))
    }

    @Test fun rejectsPathsAndUntrustedUrlParts() {
        listOf(
            "https://images.example.com/api/upload",
            "https://user:password@images.example.com",
            "https://images.example.com?next=evil",
            "https://images.example.com/#fragment",
            "file:///tmp/image",
        ).forEach { input ->
            assertThrows(IllegalArgumentException::class.java) { serverOrigin(input) }
        }
    }
}
