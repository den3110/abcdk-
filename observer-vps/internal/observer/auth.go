package observer

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const devicePrincipalContextKey = "observer.devicePrincipal"

type devicePrincipal struct {
	UserID string
	Role   string
	Token  string
}

func (s *service) requireReadKey() gin.HandlerFunc {
	return s.requireExactKey(s.cfg.ReadAPIKey, "observer read")
}

func (s *service) requireIngestKey() gin.HandlerFunc {
	return s.requireExactKey(s.cfg.APIKey, "observer ingest")
}

func (s *service) requireExactKey(expectedKey, label string) gin.HandlerFunc {
	return func(c *gin.Context) {
		providedKey := extractObserverKey(c)
		if expectedKey == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"ok":      false,
				"message": label + " auth is not configured",
			})
			c.Abort()
			return
		}
		if providedKey == "" || providedKey != expectedKey {
			c.JSON(http.StatusUnauthorized, gin.H{
				"ok":      false,
				"message": "Invalid " + label + " key",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *service) requireDeviceIngestAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if providedKey := extractObserverKey(c); providedKey != "" && providedKey == s.cfg.APIKey {
			c.Next()
			return
		}

		token := extractBearerToken(c)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"ok":      false,
				"message": "Missing observer ingest key or bearer token",
			})
			c.Abort()
			return
		}

		principal, err := s.verifyDeviceToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"ok":      false,
				"message": err.Error(),
			})
			c.Abort()
			return
		}

		c.Set(devicePrincipalContextKey, principal)
		c.Next()
	}
}

func (s *service) verifyDeviceToken(token string) (*devicePrincipal, error) {
	if strings.TrimSpace(s.cfg.JWTSecret) == "" {
		return nil, errors.New("Device bearer auth is not configured")
	}

	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(parsed *jwt.Token) (any, error) {
		if _, ok := parsed.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("Unsupported JWT signing method")
		}
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil || parsed == nil || !parsed.Valid {
		return nil, errors.New("Invalid device bearer token")
	}

	userID := strings.TrimSpace(firstString(
		claims["userId"],
		claims["id"],
		claims["_id"],
		claims["uid"],
	))
	role := strings.TrimSpace(firstString(claims["role"]))

	return &devicePrincipal{
		UserID: userID,
		Role:   role,
		Token:  token,
	}, nil
}

func extractObserverKey(c *gin.Context) string {
	providedKey := strings.TrimSpace(c.GetHeader("x-pkt-observer-key"))
	if providedKey == "" {
		providedKey = strings.TrimSpace(c.GetHeader("x-observer-key"))
	}
	return providedKey
}

func extractBearerToken(c *gin.Context) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return ""
	}
	return strings.TrimSpace(authHeader[7:])
}

func devicePrincipalFromContext(c *gin.Context) *devicePrincipal {
	value, ok := c.Get(devicePrincipalContextKey)
	if !ok {
		return nil
	}
	principal, _ := value.(*devicePrincipal)
	return principal
}
