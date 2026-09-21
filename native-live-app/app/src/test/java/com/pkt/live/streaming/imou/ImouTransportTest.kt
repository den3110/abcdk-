package com.pkt.live.streaming.imou

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Kiểm chứng TRANSPORT Imou cloud (DhRtspClient + DhavParser) qua relay THẬT.
 * Chạy: ./gradlew :app:testDebugUnitTest --tests "*ImouTransportTest" -Dimou.token=<JWT>
 * Bỏ qua nếu không có -Dimou.token (không phá CI). android.util.Log = stub
 * (unitTests.isReturnDefaultValues=true).
 */
class ImouTransportTest {

    @Test
    fun receivesVideoFramesFromCloudRelay() {
        val token = System.getProperty("imou.token")
        assumeTrue("cần -Dimou.token", !token.isNullOrBlank())
        val device = System.getProperty("imou.device") ?: "8H080FCPBVE52B7"

        val http = OkHttpClient.Builder()
            .callTimeout(60, TimeUnit.SECONDS).build()
        val req = Request.Builder()
            .url("https://pickletour.vn/api/api/tournament-auto-live/court-imou-stream-url?imouDeviceId=$device&streamId=1")
            .header("Authorization", "Bearer $token")
            .build()
        val body = http.newCall(req).execute().use { it.body?.string() ?: "" }
        println("[test] resp=${body.take(120)}")
        val url = Regex("\"url\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.get(1)
        assertTrue("không lấy được url: $body", !url.isNullOrBlank())

        val rtsp = DhRtspClient(url!!, audio = false)
        rtsp.open()
        val asm = DhavParser.Assembler()
        var videoFrames = 0
        var iFrames = 0
        val start = System.currentTimeMillis()
        rtsp.runChunkLoop { chunk ->
            asm.push(chunk)
            for (f in asm.popFrames()) {
                val t = DhavParser.frameType(f)
                if (t != DhavParser.TYPE_AUDIO) {
                    videoFrames++
                    if (t == DhavParser.TYPE_I) iFrames++
                }
            }
            System.currentTimeMillis() - start < 12_000  // chạy 12s
        }
        rtsp.close()
        println("[test] videoFrames=$videoFrames iFrames=$iFrames trong 12s")
        assertTrue("KHÔNG nhận được video frame nào từ relay", videoFrames > 0)
        assertTrue("KHÔNG có I-frame (keyframe)", iFrames > 0)
    }
}
