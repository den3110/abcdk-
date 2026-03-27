package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

const DefaultSessionTTL = 30 * 24 * time.Hour

func SignToken(secret string, claims jwt.MapClaims, ttl time.Duration) (string, time.Time, error) {
	expiresAt := time.Now().Add(ttl).UTC()
	if claims == nil {
		claims = jwt.MapClaims{}
	}
	claims["exp"] = expiresAt.Unix()
	claims["iat"] = time.Now().UTC().Unix()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}

	return token, expiresAt, nil
}

func IssueSessionCookie(c *gin.Context, secret string, userID primitive.ObjectID, role, nodeEnv string) (string, time.Time, error) {
	token, expiresAt, err := SignToken(secret, jwt.MapClaims{
		"userId": userID.Hex(),
		"role":   strings.TrimSpace(role),
	}, DefaultSessionTTL)
	if err != nil {
		return "", time.Time{}, err
	}

	SetSessionCookie(c, token, nodeEnv, expiresAt)
	return token, expiresAt, nil
}

func SetSessionCookie(c *gin.Context, token, nodeEnv string, expiresAt time.Time) {
	secure := !strings.EqualFold(strings.TrimSpace(nodeEnv), "development")

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "jwt",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(DefaultSessionTTL.Seconds()),
		Expires:  expiresAt,
	})
}

func ClearSessionCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "jwt",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})
}
