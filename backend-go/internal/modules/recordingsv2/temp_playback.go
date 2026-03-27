package recordingsv2

import (
	"fmt"
	"html"
	"strings"
)

func buildTemporaryPlaybackTitle(recording *RecordingDocument) string {
	if recording == nil {
		return "Recording"
	}
	matchID := strings.TrimSpace(recording.Match.Hex())
	recordingID := strings.TrimSpace(recording.ID.Hex())
	if matchID == "" {
		return fmt.Sprintf("Recording %s", recordingID)
	}
	return fmt.Sprintf("Recording %s - Match %s", recordingID, matchID)
}

func buildTemporaryPlaybackHTML(recording *RecordingDocument, playlistURL, playbackURL string) string {
	title := html.EscapeString(buildTemporaryPlaybackTitle(recording))
	return fmt.Sprintf(`<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>%s</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #050816; color: #e5eefb; font-family: Arial, sans-serif; }
      .wrap { min-height: 100vh; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
      .player, .meta, .status { width: 100%%; max-width: 1280px; margin: 0 auto; }
      video { width: 100%%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; }
      .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 14px; opacity: 0.9; }
      .status { padding: 10px 12px; border-radius: 10px; background: rgba(59, 130, 246, 0.12); }
      .status.error { background: rgba(239, 68, 68, 0.18); }
      a { color: #8cc2ff; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="player">
        <video id="video" controls autoplay playsinline preload="metadata"></video>
      </div>
      <div class="meta">
        <div><strong>%s</strong></div>
        <div id="segmentMeta">Dang tai danh sach segment...</div>
      </div>
      <div id="status" class="status">Dang tai temp playback tu R2...</div>
    </div>
    <script>
      const playlistUrl = %q;
      const fallbackPlaybackUrl = %q;
      const video = document.getElementById("video");
      const statusEl = document.getElementById("status");
      const segmentMetaEl = document.getElementById("segmentMeta");
      let playlist = [];
      let currentIndex = 0;

      function setStatus(message, isError = false) {
        statusEl.textContent = message;
        statusEl.className = isError ? "status error" : "status";
      }

      function setSegmentMeta() {
        if (!playlist.length) {
          segmentMetaEl.textContent = "Khong co segment nao de phat";
          return;
        }
        const current = playlist[currentIndex] || playlist[0];
        segmentMetaEl.textContent =
          "Segment " + (currentIndex + 1) + "/" + playlist.length +
          " - #" + current.index + " - " + (current.durationSeconds || 0) + "s";
      }

      function playIndex(index) {
        if (!playlist[index]) {
          setStatus("Da phat xong recording tam.");
          return;
        }
        currentIndex = index;
        setSegmentMeta();
        const item = playlist[index];
        setStatus("Dang phat segment " + (index + 1) + "/" + playlist.length + " tu R2...");
        video.src = item.url;
        video.play().catch(() => {});
      }

      video.addEventListener("ended", () => {
        playIndex(currentIndex + 1);
      });

      fetch(playlistUrl, { credentials: "omit" })
        .then((response) => response.json())
        .then((payload) => {
          if (payload.redirectUrl) {
            window.location.replace(payload.redirectUrl || fallbackPlaybackUrl || "/");
            return;
          }
          if (!payload.ok || !payload.ready) {
            throw new Error(payload.message || "Recording temporary playback is not ready yet");
          }
          playlist = Array.isArray(payload.segments) ? payload.segments : [];
          if (!playlist.length) {
            throw new Error("Khong co segment nao san sang de phat");
          }
          playIndex(0);
        })
        .catch((error) => {
          setStatus(error.message || "Khong the tai playlist temp playback.", true);
        });
    </script>
  </body>
</html>`, title, title, playlistURL, playbackURL)
}
