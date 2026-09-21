package com.pkt.live.streaming.imou

/**
 * Port DHAVParser.swift (đường LIVE: KHÔNG giải mã — key rỗng).
 * DHAV frame: 'DHAV' | type(0x04) | ... | size LE @0x0c | ext_hdr_len @0x16 |
 *   ext(0x18..) | payload(Annex-B NAL) | 'dhav' trailer(size-8..) .
 */
object DhavParser {

    const val TYPE_I = 0xfd
    const val TYPE_P = 0xfc
    const val TYPE_AUDIO = 0xf0

    /** type byte tại offset 0x04. */
    fun frameType(frame: ByteArray): Int =
        if (frame.size > 4) frame[4].toInt() and 0xff else 0

    /** payload Annex-B: frame[0x18+extLen .. size-8]. */
    fun extractPayload(frame: ByteArray): ByteArray? {
        if (frame.size <= 0x18) return null
        val extHdrLen = frame[0x16].toInt() and 0xff
        val pStart = 0x18 + extHdrLen
        val pEnd = frame.size - 8
        if (pStart >= pEnd) return null
        return frame.copyOfRange(pStart, pEnd)
    }

    /** Gom chunk DHAV → frame đầy đủ. */
    class Assembler {
        private var buf = ByteArray(256 * 1024)
        private var len = 0
        private var readIdx = 0

        fun push(chunk: ByteArray) {
            if (len + chunk.size > buf.size) buf = buf.copyOf(maxOf(buf.size * 2, len + chunk.size))
            System.arraycopy(chunk, 0, buf, len, chunk.size); len += chunk.size
            if (readIdx > 64 * 1024) {
                System.arraycopy(buf, readIdx, buf, 0, len - readIdx); len -= readIdx; readIdx = 0
            }
        }

        private fun findDhav(from: Int): Int {
            var i = from
            val end = len - 4
            while (i <= end) {
                if (buf[i] == 0x44.toByte() && buf[i + 1] == 0x48.toByte() &&
                    buf[i + 2] == 0x41.toByte() && buf[i + 3] == 0x56.toByte()) return i
                i++
            }
            return -1
        }

        fun popFrames(): List<ByteArray> {
            val out = ArrayList<ByteArray>()
            while (true) {
                val found = findDhav(readIdx)
                if (found < 0) break
                readIdx = found
                val remaining = len - readIdx
                if (remaining < 24) break
                val size = (buf[readIdx + 12].toInt() and 0xff) or
                        ((buf[readIdx + 13].toInt() and 0xff) shl 8) or
                        ((buf[readIdx + 14].toInt() and 0xff) shl 16) or
                        ((buf[readIdx + 15].toInt() and 0xff) shl 24)
                if (size < 32 || size > 64 * 1024 * 1024) { readIdx += 4; continue }
                if (remaining < size) break
                out.add(buf.copyOfRange(readIdx, readIdx + size))
                readIdx += size
            }
            return out
        }
    }
}
