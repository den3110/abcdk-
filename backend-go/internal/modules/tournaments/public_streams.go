package tournaments

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

func attachPublicStreamsToMatch(c *gin.Context, match bson.M, recording bson.M) bson.M {
	streams, defaultStreamKey, hasMultipleStreams := buildPublicStreamsForMatch(c, match, recording)
	existingStreams := normalizeStreamSlice(match["streams"])
	effectiveStreams := streams
	if len(effectiveStreams) == 0 {
		effectiveStreams = existingStreams
	}

	out := cloneMap(match)
	out["streams"] = effectiveStreams
	if len(streams) > 0 {
		out["defaultStreamKey"] = emptyStringToNilString(defaultStreamKey)
		out["hasMultipleStreams"] = hasMultipleStreams
		return out
	}

	existingDefault := strings.TrimSpace(stringValue(out["defaultStreamKey"]))
	if existingDefault == "" && len(effectiveStreams) > 0 {
		existingDefault = strings.TrimSpace(stringValue(effectiveStreams[0]["key"]))
	}
	out["defaultStreamKey"] = emptyStringToNilString(existingDefault)
	out["hasMultipleStreams"] = len(effectiveStreams) > 1
	return out
}

func buildPublicStreamsForMatch(c *gin.Context, match bson.M, recording bson.M) ([]bson.M, string, bool) {
	streams := make([]bson.M, 0, 4)
	finishedLike := isFinishedLikeStatus(stringValue(match["status"])) || isFinishedLikeStatus(nestedStringMap(mapValue(match["facebookLive"]), "status"))
	server2 := buildRecordingServer2State(c, recording)
	facebookOpenURL := selectFacebookOpenURL(match)
	if facebookOpenURL != "" && !(finishedLike && len(server2) > 0 && boolValueDefault(server2["ready"], false)) {
		pushUniqueStream(&streams, bson.M{
			"key":           "server1",
			"displayLabel":  "Server 1",
			"providerLabel": "Facebook",
			"kind":          "facebook",
			"priority":      1,
			"status":        "ready",
			"playUrl":       facebookOpenURL,
			"openUrl":       facebookOpenURL,
			"delaySeconds":  0,
			"ready":         true,
		})
	}

	if len(server2) > 0 && (stringValue(server2["manifestUrl"]) != "" || stringValue(server2["finalPlaybackUrl"]) != "") {
		pushUniqueStream(&streams, bson.M{
			"key":            stringValue(server2["key"]),
			"displayLabel":   stringValue(server2["displayLabel"]),
			"providerLabel":  stringValue(server2["providerLabel"]),
			"kind":           firstNonEmpty(stringValue(server2["kind"]), "file"),
			"priority":       2,
			"status":         stringValue(server2["status"]),
			"playUrl":        firstNonEmpty(stringValue(server2["finalPlaybackUrl"]), stringValue(server2["manifestUrl"])),
			"openUrl":        emptyStringToNilString(stringValue(server2["finalPlaybackUrl"])),
			"delaySeconds":   intValueDefault(server2["delaySeconds"], 0),
			"ready":          boolValueDefault(server2["ready"], false),
			"disabledReason": emptyStringToNilString(stringValue(server2["disabledReason"])),
			"meta": bson.M{
				"manifestUrl":             emptyStringToNilString(stringValue(server2["manifestUrl"])),
				"manifestObjectKey":       emptyStringToNilString(stringValue(server2["manifestObjectKey"])),
				"finalPlaybackUrl":        emptyStringToNilString(stringValue(server2["finalPlaybackUrl"])),
				"publicBaseUrl":           emptyStringToNilString(stringValue(server2["publicBaseUrl"])),
				"uploadedDurationSeconds": numberValue(server2["uploadedDurationSeconds"]),
				"uploadedSegmentCount":    intValueDefault(server2["uploadedSegmentCount"], 0),
			},
		})
	}

	aiCommentary := buildRecordingAICommentaryState(c, recording)
	if len(aiCommentary) > 0 && (stringValue(aiCommentary["finalPlaybackUrl"]) != "" || stringValue(aiCommentary["rawUrl"]) != "") {
		pushUniqueStream(&streams, bson.M{
			"key":           "ai_commentary",
			"displayLabel":  "BLV AI",
			"providerLabel": "AI Commentary",
			"kind":          "file",
			"priority":      3,
			"status":        firstNonEmpty(stringValue(aiCommentary["status"]), "ready"),
			"playUrl":       firstNonEmpty(stringValue(aiCommentary["finalPlaybackUrl"]), stringValue(aiCommentary["rawUrl"])),
			"openUrl": firstNonEmpty(
				stringValue(aiCommentary["previewUrl"]),
				stringValue(aiCommentary["rawUrl"]),
				stringValue(aiCommentary["finalPlaybackUrl"]),
			),
			"delaySeconds": 0,
			"ready":        boolValueDefault(aiCommentary["ready"], false),
			"meta": bson.M{
				"previewUrl":       emptyStringToNilString(stringValue(aiCommentary["previewUrl"])),
				"rawUrl":           emptyStringToNilString(stringValue(aiCommentary["rawUrl"])),
				"finalPlaybackUrl": emptyStringToNilString(stringValue(aiCommentary["finalPlaybackUrl"])),
			},
		})
	}

	legacyPlaybackURL := selectLegacyPlaybackURL(match)
	if legacyPlaybackURL != "" {
		normalizedLegacyURL := strings.TrimSpace(legacyPlaybackURL)
		legacyRecordingID := extractInternalRecordingID(normalizedLegacyURL)
		duplicate := false
		for _, stream := range streams {
			streamPlayURL := strings.TrimSpace(stringValue(stream["playUrl"]))
			streamOpenURL := strings.TrimSpace(stringValue(stream["openUrl"]))
			if streamPlayURL == normalizedLegacyURL || streamOpenURL == normalizedLegacyURL {
				duplicate = true
				break
			}

			if legacyRecordingID == "" {
				continue
			}
			streamRecordingID := firstNonEmpty(
				extractInternalRecordingID(streamPlayURL),
				extractInternalRecordingID(streamOpenURL),
			)
			if streamRecordingID != "" && streamRecordingID == legacyRecordingID {
				duplicate = true
				break
			}
		}

		if !duplicate {
			kind := detectLegacyKind(normalizedLegacyURL)
			if kind == "facebook" {
				pushUniqueStream(&streams, bson.M{
					"key":           "server1",
					"displayLabel":  "Server 1",
					"providerLabel": "Facebook",
					"kind":          "facebook",
					"priority":      1,
					"status":        "ready",
					"playUrl":       normalizedLegacyURL,
					"openUrl":       normalizedLegacyURL,
					"delaySeconds":  0,
					"ready":         true,
				})
			} else {
				hasServer2 := false
				for _, stream := range streams {
					if stringValue(stream["key"]) == "server2" {
						hasServer2 = true
						break
					}
				}
				key := "server2"
				displayLabel := "Server 2"
				providerLabel := "PickleTour"
				priority := 2
				if hasServer2 {
					key = "legacy_video"
					displayLabel = "Video"
					providerLabel = "Video"
					priority = 3
				}
				pushUniqueStream(&streams, bson.M{
					"key":           key,
					"displayLabel":  displayLabel,
					"providerLabel": providerLabel,
					"kind":          firstNonEmpty(kind, "iframe"),
					"priority":      priority,
					"status":        "ready",
					"playUrl":       normalizedLegacyURL,
					"openUrl":       normalizedLegacyURL,
					"delaySeconds":  0,
					"ready":         true,
				})
			}
		}
	}

	if youtubeWatchURL, youtubeEmbedURL := selectYouTubeWatchURLs(match); youtubeWatchURL != "" || youtubeEmbedURL != "" {
		pushUniqueStream(&streams, bson.M{
			"key":           "youtube",
			"displayLabel":  "YouTube",
			"providerLabel": "YouTube",
			"kind":          "iframe",
			"priority":      3,
			"status":        "ready",
			"playUrl":       firstNonEmpty(youtubeEmbedURL, youtubeWatchURL),
			"openUrl":       firstNonEmpty(youtubeWatchURL, youtubeEmbedURL),
			"delaySeconds":  0,
			"ready":         true,
		})
	}

	if tiktokWatchURL := selectTikTokWatchURL(match); tiktokWatchURL != "" {
		pushUniqueStream(&streams, bson.M{
			"key":           "tiktok",
			"displayLabel":  "TikTok",
			"providerLabel": "TikTok",
			"kind":          "iframe",
			"priority":      4,
			"status":        "ready",
			"playUrl":       tiktokWatchURL,
			"openUrl":       tiktokWatchURL,
			"delaySeconds":  0,
			"ready":         true,
		})
	}

	if rtmpPublicURL := selectRTMPPublicURL(match); rtmpPublicURL != "" {
		pushUniqueStream(&streams, bson.M{
			"key":           "rtmp",
			"displayLabel":  "RTMP",
			"providerLabel": "RTMP",
			"kind":          firstNonEmpty(detectLegacyKind(rtmpPublicURL), "iframe"),
			"priority":      5,
			"status":        "ready",
			"playUrl":       rtmpPublicURL,
			"openUrl":       rtmpPublicURL,
			"delaySeconds":  0,
			"ready":         true,
		})
	}

	defaultStreamKey := ""
	if len(streams) > 0 {
		defaultStreamKey = stringValue(streams[0]["key"])
	}

	matchStatus := strings.ToLower(strings.TrimSpace(stringValue(match["status"])))
	if matchStatus == "live" {
		defaultStreamKey = firstReadyStreamKey(streams, "server1", "server2", defaultStreamKey)
	}
	if finishedLike {
		defaultStreamKey = firstReadyStreamKey(streams, "server2", "server1", defaultStreamKey)
	}

	return streams, defaultStreamKey, len(streams) > 1
}

func buildRecordingServer2State(c *gin.Context, recording bson.M) bson.M {
	if len(recording) == 0 {
		return nil
	}

	recordingID := objectIDHex(recording["_id"])
	if recordingID == "" {
		recordingID = strings.TrimSpace(stringValue(recording["_id"]))
	}
	if recordingID == "" {
		return nil
	}

	meta := mapValue(recording["meta"])
	livePlayback := mapValue(meta["livePlayback"])
	manifestObjectKey := firstNonEmpty(
		stringValue(livePlayback["manifestObjectKey"]),
	)
	manifestURL := strings.TrimSpace(stringValue(livePlayback["manifestUrl"]))
	publicBaseURL := strings.TrimSpace(stringValue(livePlayback["publicBaseUrl"]))
	if manifestURL == "" && manifestObjectKey != "" && publicBaseURL != "" {
		manifestURL = strings.TrimRight(publicBaseURL, "/") + "/" + strings.TrimLeft(manifestObjectKey, "/")
	}

	finalPlaybackURL := pickFinalServer2URL(c, recording, recordingID)
	uploadedSegmentCount, uploadedDurationSeconds := summarizeUploadedSegments(recording)
	status := strings.ToLower(strings.TrimSpace(stringValue(recording["status"])))
	ready := finalPlaybackURL != "" || manifestURL != ""
	if !ready {
		return nil
	}

	streamStatus := status
	delaySeconds := 0
	disabledReason := ""
	kind := "file"
	if finalPlaybackURL == "" && manifestURL != "" {
		kind = "delayed_manifest"
		delaySeconds = intValueDefault(livePlayback["delaySeconds"], 0)
		if delaySeconds == 0 {
			delaySeconds = 45
		}
		if status == "" {
			streamStatus = "ready"
		}
		if status == "recording" || status == "uploading" || status == "pending_export_window" || status == "exporting" {
			if uploadedSegmentCount > 0 {
				streamStatus = "preparing"
			}
			if !boolValueDefault(livePlayback["ready"], false) && finalPlaybackURL == "" {
				disabledReason = "Dang chuan bi luong tre tu PickleTour CDN."
			}
		}
	}
	if streamStatus == "" {
		streamStatus = "ready"
	}

	providerLabel := "PickleTour CDN"
	if finalPlaybackURL != "" {
		providerLabel = "PickleTour Video"
		delaySeconds = 0
	}

	return bson.M{
		"key":                     "server2",
		"displayLabel":            "Server 2",
		"providerLabel":           providerLabel,
		"kind":                    kind,
		"manifestObjectKey":       emptyStringToNilString(manifestObjectKey),
		"manifestUrl":             emptyStringToNilString(manifestURL),
		"publicBaseUrl":           emptyStringToNilString(publicBaseURL),
		"finalPlaybackUrl":        emptyStringToNilString(finalPlaybackURL),
		"delaySeconds":            delaySeconds,
		"uploadedDurationSeconds": uploadedDurationSeconds,
		"uploadedSegmentCount":    uploadedSegmentCount,
		"ready":                   ready,
		"status":                  streamStatus,
		"disabledReason":          emptyStringToNilString(disabledReason),
	}
}

func buildRecordingAICommentaryState(c *gin.Context, recording bson.M) bson.M {
	if len(recording) == 0 {
		return nil
	}
	ai := mapValue(recording["aiCommentary"])
	if len(ai) == 0 {
		return nil
	}

	recordingID := objectIDHex(recording["_id"])
	playbackURL := strings.TrimSpace(stringValue(ai["dubbedPlaybackUrl"]))
	if playbackURL == "" && recordingID != "" && (stringValue(ai["dubbedDriveFileId"]) != "" || stringValue(ai["dubbedDriveRawUrl"]) != "") {
		playbackURL = buildAICommentaryPlaybackURL(c, recordingID)
	}

	rawURL := strings.TrimSpace(stringValue(ai["dubbedDriveRawUrl"]))
	if rawURL == "" && recordingID != "" && stringValue(ai["dubbedDriveFileId"]) != "" {
		rawURL = buildAICommentaryRawURL(c, recordingID)
	}

	previewURL := strings.TrimSpace(stringValue(ai["dubbedDrivePreviewUrl"]))
	ready := stringValue(ai["dubbedDriveFileId"]) != "" || rawURL != "" || playbackURL != "" || previewURL != ""
	if !ready {
		return nil
	}

	return bson.M{
		"status":           firstNonEmpty(stringValue(ai["status"]), "ready"),
		"finalPlaybackUrl": emptyStringToNilString(playbackURL),
		"rawUrl":           emptyStringToNilString(rawURL),
		"previewUrl":       emptyStringToNilString(previewURL),
		"ready":            true,
	}
}

func selectFacebookOpenURL(match bson.M) string {
	fb := mapValue(match["facebookLive"])
	metaFB := mapValue(mapValue(match["meta"])["facebook"])
	finishedLike := isFinishedLikeStatus(stringValue(match["status"])) || isFinishedLikeStatus(stringValue(fb["status"]))

	candidates := []string{}
	if finishedLike {
		candidates = []string{
			stringValue(fb["video_permalink_url"]),
			stringValue(fb["watch_url"]),
			stringValue(fb["permalink_url"]),
			stringValue(metaFB["permalinkUrl"]),
			stringValue(fb["raw_permalink_url"]),
			stringValue(fb["embed_url"]),
		}
	} else {
		candidates = []string{
			stringValue(fb["watch_url"]),
			stringValue(fb["permalink_url"]),
			stringValue(metaFB["permalinkUrl"]),
			stringValue(fb["video_permalink_url"]),
			stringValue(fb["raw_permalink_url"]),
			stringValue(fb["embed_url"]),
		}
	}
	return firstNonEmpty(candidates...)
}

func selectYouTubeWatchURLs(match bson.M) (string, string) {
	meta := mapValue(match["meta"])
	youtube := mapValue(meta["youtube"])
	youtubeLive := mapValue(match["youtubeLive"])
	videoID := firstNonEmpty(
		stringValue(youtube["videoId"]),
		stringValue(youtubeLive["id"]),
	)
	if videoID == "" {
		watchURL := firstNonEmpty(
			stringValue(youtube["watchUrl"]),
			stringValue(youtubeLive["watch_url"]),
		)
		if watchURL != "" {
			if parsedID := parseYouTubeVideoID(watchURL); parsedID != "" {
				videoID = parsedID
			}
			return watchURL, buildYouTubeEmbedURL(videoID)
		}
		return "", ""
	}
	return "https://www.youtube.com/watch?v=" + url.QueryEscape(videoID), buildYouTubeEmbedURL(videoID)
}

func parseYouTubeVideoID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsedURL, err := url.Parse(trimmed)
	if err == nil {
		if strings.Contains(parsedURL.Host, "youtu.be") {
			parts := strings.Split(strings.Trim(parsedURL.Path, "/"), "/")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
		if value := strings.TrimSpace(parsedURL.Query().Get("v")); value != "" {
			return value
		}
		parts := strings.Split(strings.Trim(parsedURL.Path, "/"), "/")
		for index, part := range parts {
			switch strings.ToLower(part) {
			case "live", "shorts", "embed":
				if index+1 < len(parts) {
					return strings.TrimSpace(parts[index+1])
				}
			}
		}
	}
	for _, pattern := range []string{"v=", "youtu.be/"} {
		if index := strings.Index(strings.ToLower(trimmed), strings.ToLower(pattern)); index >= 0 {
			slice := trimmed[index+len(pattern):]
			slice = strings.Split(slice, "&")[0]
			slice = strings.Split(slice, "?")[0]
			slice = strings.Split(slice, "/")[0]
			return strings.TrimSpace(slice)
		}
	}
	return ""
}

func buildYouTubeEmbedURL(videoID string) string {
	videoID = strings.TrimSpace(videoID)
	if videoID == "" {
		return ""
	}
	return "https://www.youtube-nocookie.com/embed/" + url.QueryEscape(videoID)
}

func selectTikTokWatchURL(match bson.M) string {
	meta := mapValue(match["meta"])
	tiktok := mapValue(meta["tiktok"])
	tiktokLive := mapValue(match["tiktokLive"])
	direct := firstNonEmpty(
		stringValue(tiktok["watchUrl"]),
		stringValue(tiktokLive["room_url"]),
		stringValue(tiktok["url"]),
	)
	if direct != "" {
		return direct
	}
	username := firstNonEmpty(
		stringValue(tiktok["username"]),
		stringValue(tiktokLive["username"]),
	)
	if username == "" {
		return ""
	}
	return "https://www.tiktok.com/@" + url.PathEscape(username) + "/live"
}

func selectRTMPPublicURL(match bson.M) string {
	return firstNonEmpty(
		stringValue(mapValue(mapValue(match["meta"])["rtmp"])["publicUrl"]),
		stringValue(mapValue(mapValue(match["meta"])["rtmp"])["viewUrl"]),
		stringValue(mapValue(mapValue(match["meta"])["rtmp"])["url"]),
	)
}

func selectLegacyPlaybackURL(match bson.M) string {
	return firstNonEmpty(
		stringValue(match["video"]),
		stringValue(match["playbackUrl"]),
		stringValue(match["streamUrl"]),
		stringValue(match["liveUrl"]),
	)
}

func detectLegacyKind(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case value == "":
		return ""
	case strings.Contains(value, "facebook.com"), strings.Contains(value, "fb.watch"):
		return "facebook"
	case strings.Contains(value, ".m3u8"):
		return "hls"
	case strings.Contains(value, "/api/live/recordings/v2/") && (strings.Contains(value, "/play") || strings.Contains(value, "/raw")):
		return "file"
	case strings.Contains(value, ".mp4"), strings.Contains(value, ".webm"), strings.Contains(value, ".ogv"), strings.Contains(value, ".ogg"):
		return "file"
	default:
		return "iframe"
	}
}

func extractInternalRecordingID(raw string) string {
	normalized := strings.TrimSpace(raw)
	if normalized == "" {
		return ""
	}
	lower := strings.ToLower(normalized)
	marker := "/api/live/recordings/v2/"
	index := strings.Index(lower, marker)
	if index < 0 {
		return ""
	}
	rest := normalized[index+len(marker):]
	parts := strings.Split(rest, "/")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func pushUniqueStream(streams *[]bson.M, candidate bson.M) {
	if len(candidate) == 0 {
		return
	}
	candidatePlayURL := strings.TrimSpace(stringValue(candidate["playUrl"]))
	candidateOpenURL := strings.TrimSpace(stringValue(candidate["openUrl"]))
	for _, stream := range *streams {
		playURL := strings.TrimSpace(stringValue(stream["playUrl"]))
		openURL := strings.TrimSpace(stringValue(stream["openUrl"]))
		if candidatePlayURL != "" && (candidatePlayURL == playURL || candidatePlayURL == openURL) {
			return
		}
		if candidateOpenURL != "" && (candidateOpenURL == playURL || candidateOpenURL == openURL) {
			return
		}
	}
	*streams = append(*streams, candidate)
}

func normalizeStreamSlice(value any) []bson.M {
	items := sliceValue(value)
	streams := make([]bson.M, 0, len(items))
	for _, item := range items {
		stream := mapValue(item)
		if len(stream) == 0 {
			continue
		}
		streams = append(streams, stream)
	}
	return streams
}

func firstReadyStreamKey(streams []bson.M, keys ...string) string {
	if len(streams) == 0 {
		return ""
	}
	for _, key := range keys {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		for _, stream := range streams {
			if strings.TrimSpace(stringValue(stream["key"])) == trimmed && boolValueDefault(firstPresent(stream["ready"], true), true) {
				return trimmed
			}
		}
	}
	for _, stream := range streams {
		if key := strings.TrimSpace(stringValue(stream["key"])); key != "" {
			return key
		}
	}
	return ""
}

func isFinishedLikeStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "finished", "ended", "stopped":
		return true
	default:
		return false
	}
}

func summarizeUploadedSegments(recording bson.M) (int, float64) {
	totalCount := 0
	totalDuration := 0.0
	for _, item := range sliceValue(recording["segments"]) {
		segment := mapValue(item)
		if strings.ToLower(strings.TrimSpace(stringValue(segment["uploadStatus"]))) != "uploaded" {
			continue
		}
		totalCount++
		totalDuration += numberValue(segment["durationSeconds"])
	}
	return totalCount, totalDuration
}

func pickFinalServer2URL(c *gin.Context, recording bson.M, recordingID string) string {
	for _, value := range []any{
		recording["driveRawUrl"],
		recording["drivePreviewUrl"],
		recording["playbackUrl"],
	} {
		if candidate := strings.TrimSpace(stringValue(value)); candidate != "" {
			return candidate
		}
	}
	if strings.TrimSpace(stringValue(recording["driveFileId"])) != "" || strings.ToLower(strings.TrimSpace(stringValue(recording["status"]))) == "ready" {
		return buildRecordingPlaybackURL(c, recordingID)
	}
	return ""
}

func buildRecordingPlaybackURL(c *gin.Context, recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/play", playbackBaseURL(c), strings.TrimSpace(recordingID))
}

func buildAICommentaryPlaybackURL(c *gin.Context, recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/commentary/play", playbackBaseURL(c), strings.TrimSpace(recordingID))
}

func buildAICommentaryRawURL(c *gin.Context, recordingID string) string {
	return fmt.Sprintf("%s/api/live/recordings/v2/%s/commentary/raw", playbackBaseURL(c), strings.TrimSpace(recordingID))
}

func playbackBaseURL(c *gin.Context) string {
	for _, key := range []string{"LIVE_RECORDING_PLAYBACK_BASE_URL", "PUBLIC_API_BASE_URL", "API_URL", "HOST", "FRONTEND_URL"} {
		if value := strings.TrimRight(strings.TrimSpace(os.Getenv(key)), "/"); value != "" {
			return value
		}
	}
	if c != nil && c.Request != nil {
		scheme := "https"
		if strings.EqualFold(strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Proto")), "http") || c.Request.TLS == nil {
			if strings.TrimSpace(c.Request.Host) == "" {
				scheme = "https"
			} else if strings.EqualFold(strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Proto")), "https") {
				scheme = "https"
			} else if c.Request.TLS == nil {
				scheme = "http"
			}
		}
		host := strings.TrimSpace(c.Request.Header.Get("X-Forwarded-Host"))
		if host == "" {
			host = strings.TrimSpace(c.Request.Host)
		}
		if host != "" {
			return scheme + "://" + host
		}
	}
	return "https://pickletour.vn"
}

func cloneMap(input bson.M) bson.M {
	if len(input) == 0 {
		return bson.M{}
	}
	out := make(bson.M, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return 0
		}
		return parsed
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(typed)), 64)
		if err != nil {
			return 0
		}
		return parsed
	}
}

func emptyStringToNilString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
