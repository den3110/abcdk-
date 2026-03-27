package httpx

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

func ToPublicURL(c *gin.Context, value string, absolute bool) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return raw
	}

	if isAbsoluteHTTPURL(raw) {
		return normalizeAbsoluteHTTPURL(raw)
	}

	if !absolute {
		return raw
	}

	baseURL := publicBaseURL(c)
	if baseURL == "" {
		return raw
	}

	parsedBase, err := url.Parse(baseURL)
	if err != nil {
		return raw
	}
	parsedValue, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return parsedBase.ResolveReference(parsedValue).String()
}

func publicBaseURL(c *gin.Context) string {
	for _, key := range []string{"EXTERNAL_BASE_URL", "HOST", "WEB_URL"} {
		if value := normalizeAbsoluteHTTPURL(os.Getenv(key)); value != "" {
			return value
		}
	}

	proto := forwardedValue(c.GetHeader("X-Forwarded-Proto"))
	if proto == "" {
		if c.Request != nil && c.Request.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}

	host := forwardedValue(c.GetHeader("X-Forwarded-Host"))
	if host == "" && c.Request != nil {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}

	return normalizeAbsoluteHTTPURL(proto + "://" + host)
}

func forwardedValue(value string) string {
	return strings.TrimSpace(strings.Split(strings.TrimSpace(value), ",")[0])
}

func isAbsoluteHTTPURL(value string) bool {
	raw := strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://")
}

func normalizeAbsoluteHTTPURL(value string) string {
	raw := strings.TrimSpace(value)
	if !isAbsoluteHTTPURL(raw) {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") {
		parsed.Scheme = "https"
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/")
}

func ClearCacheHeaders(w http.ResponseWriter) {
	w.Header().Del("Cache-Control")
}
