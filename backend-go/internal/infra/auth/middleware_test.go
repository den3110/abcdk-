package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type fakeUserStore struct {
	users map[primitive.ObjectID]*User
}

func (s fakeUserStore) FindByID(_ context.Context, id primitive.ObjectID) (*User, error) {
	return s.users[id], nil
}

func TestRequireAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)

	adminID := primitive.NewObjectID()
	userID := primitive.NewObjectID()
	secret := "test-secret"

	store := fakeUserStore{
		users: map[primitive.ObjectID]*User{
			adminID: {ID: adminID, Role: "admin"},
			userID:  {ID: userID, Role: "user"},
		},
	}

	router := gin.New()
	router.GET("/secure", RequireAdmin(secret, store), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	tests := []struct {
		name       string
		setup      func(*http.Request)
		wantStatus int
	}{
		{
			name: "header token admin",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+mustSignToken(t, secret, adminID.Hex()))
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "cookie token admin",
			setup: func(req *http.Request) {
				req.AddCookie(&http.Cookie{Name: "jwt", Value: mustSignToken(t, secret, adminID.Hex())})
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "invalid token",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer invalid")
			},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "non admin",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+mustSignToken(t, secret, userID.Hex()))
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "missing token",
			setup:      func(_ *http.Request) {},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/secure", nil)
			tt.setup(req)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, recorder.Code)
			}
		})
	}
}

func TestRequireUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := primitive.NewObjectID()
	deletedUserID := primitive.NewObjectID()
	secret := "test-secret"

	store := fakeUserStore{
		users: map[primitive.ObjectID]*User{
			userID:        {ID: userID, Role: "user"},
			deletedUserID: {ID: deletedUserID, Role: "user", IsDeleted: true},
		},
	}

	router := gin.New()
	router.GET("/secure", RequireUser(secret, store), func(c *gin.Context) {
		value, exists := c.Get("user")
		if !exists || value == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"ok": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	tests := []struct {
		name       string
		setup      func(*http.Request)
		wantStatus int
	}{
		{
			name: "header token user",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+mustSignToken(t, secret, userID.Hex()))
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "cookie token user",
			setup: func(req *http.Request) {
				req.AddCookie(&http.Cookie{Name: "jwt", Value: mustSignToken(t, secret, userID.Hex())})
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "deleted user",
			setup: func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+mustSignToken(t, secret, deletedUserID.Hex()))
			},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "missing token",
			setup:      func(_ *http.Request) {},
			wantStatus: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/secure", nil)
			tt.setup(req)

			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, req)

			if recorder.Code != tt.wantStatus {
				t.Fatalf("expected status %d, got %d", tt.wantStatus, recorder.Code)
			}
		})
	}
}

func mustSignToken(t *testing.T, secret, userID string) string {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"userId": userID,
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	return token
}
