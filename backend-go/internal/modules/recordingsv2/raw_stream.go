package recordingsv2

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

var rangeHeaderRegexp = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

func applyRawVideoHeaders(target http.Header, source http.Header, fileLabel, driveAuthMode string) {
	for _, pair := range [][2]string{
		{"Content-Type", "Content-Type"},
		{"Content-Length", "Content-Length"},
		{"Content-Range", "Content-Range"},
		{"Accept-Ranges", "Accept-Ranges"},
		{"ETag", "ETag"},
		{"Last-Modified", "Last-Modified"},
	} {
		if value := strings.TrimSpace(source.Get(pair[0])); value != "" {
			target.Set(pair[1], value)
		}
	}

	if target.Get("Content-Type") == "" {
		target.Set("Content-Type", "video/mp4")
	}
	if target.Get("Accept-Ranges") == "" {
		target.Set("Accept-Ranges", "bytes")
	}

	target.Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", firstNonEmptyString(strings.TrimSpace(fileLabel), "recording.mp4")))
	target.Set("Access-Control-Allow-Origin", "*")
	target.Set("Access-Control-Allow-Headers", "Range")
	target.Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type")
	target.Set("Cross-Origin-Resource-Policy", "cross-origin")
	target.Set("Cache-Control", "public, max-age=300, stale-while-revalidate=60")
	target.Set("X-Recording-Drive-Auth-Mode", firstNonEmptyString(strings.TrimSpace(driveAuthMode), "unknown"))
}

func applyRawVideoFallbackRangeHeaders(target http.Header, rangeHeader string, totalSize int64) {
	rangeHeader = strings.TrimSpace(rangeHeader)
	if parsed, ok := parseByteRangeHeader(rangeHeader, totalSize); ok {
		if target.Get("Content-Range") == "" {
			target.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", parsed.start, parsed.end, parsed.total))
		}
		if target.Get("Content-Length") == "" {
			target.Set("Content-Length", strconv.FormatInt(parsed.length, 10))
		}
		return
	}

	if totalSize > 0 && target.Get("Content-Length") == "" {
		target.Set("Content-Length", strconv.FormatInt(totalSize, 10))
	}
}

type byteRange struct {
	start  int64
	end    int64
	length int64
	total  int64
}

func parseByteRangeHeader(rangeHeader string, totalSize int64) (byteRange, bool) {
	if totalSize <= 0 {
		return byteRange{}, false
	}
	match := rangeHeaderRegexp.FindStringSubmatch(strings.TrimSpace(rangeHeader))
	if len(match) != 3 {
		return byteRange{}, false
	}

	startRaw := match[1]
	endRaw := match[2]
	if startRaw == "" && endRaw == "" {
		return byteRange{}, false
	}

	if startRaw == "" {
		suffixLength, err := strconv.ParseInt(endRaw, 10, 64)
		if err != nil || suffixLength <= 0 {
			return byteRange{}, false
		}
		start := totalSize - suffixLength
		if start < 0 {
			start = 0
		}
		end := totalSize - 1
		return byteRange{start: start, end: end, length: end - start + 1, total: totalSize}, true
	}

	start, err := strconv.ParseInt(startRaw, 10, 64)
	if err != nil || start < 0 || start >= totalSize {
		return byteRange{}, false
	}

	end := totalSize - 1
	if endRaw != "" {
		end, err = strconv.ParseInt(endRaw, 10, 64)
		if err != nil || end < start {
			return byteRange{}, false
		}
		if end >= totalSize {
			end = totalSize - 1
		}
	}

	return byteRange{start: start, end: end, length: end - start + 1, total: totalSize}, true
}
