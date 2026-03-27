package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

type User struct {
	ID           primitive.ObjectID `bson:"_id" json:"_id"`
	Name         string             `bson:"name" json:"name"`
	Nickname     string             `bson:"nickname" json:"nickname"`
	FullName     string             `bson:"fullName" json:"fullName"`
	Phone        string             `bson:"phone" json:"phone"`
	Email        string             `bson:"email" json:"email"`
	Role         string             `bson:"role" json:"role"`
	Roles        []string           `bson:"roles" json:"roles"`
	IsAdmin      bool               `bson:"isAdmin" json:"isAdmin"`
	IsSuperUser  bool               `bson:"isSuperUser" json:"isSuperUser"`
	IsSuperAdmin bool               `bson:"isSuperAdmin" json:"isSuperAdmin"`
	IsDeleted    bool               `bson:"isDeleted" json:"isDeleted"`
}

type UserStore interface {
	FindByID(ctx context.Context, id primitive.ObjectID) (*User, error)
}

type MongoUserStore struct {
	collection *mongo.Collection
}

func NewMongoUserStore(collection *mongo.Collection) *MongoUserStore {
	return &MongoUserStore{collection: collection}
}

func (s *MongoUserStore) FindByID(ctx context.Context, id primitive.ObjectID) (*User, error) {
	var user User
	err := s.collection.FindOne(ctx, bson.M{"_id": id}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func RequireAdmin(secret string, users UserStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := authenticateUser(c, secret, users)
		if !ok {
			return
		}
		if !isAdmin(user) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Forbidden - insufficient role"})
			return
		}
		c.Next()
	}
}

func RequireUser(secret string, users UserStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := authenticateUser(c, secret, users); !ok {
			return
		}
		c.Next()
	}
}

func OptionalUser(secret string, users UserStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(secret) == "" {
			c.Next()
			return
		}

		tokenValue := ExtractToken(c)
		if tokenValue == "" {
			c.Next()
			return
		}

		token, err := jwt.Parse(tokenValue, func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.Next()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.Next()
			return
		}

		userID, err := extractUserID(claims)
		if err != nil {
			c.Next()
			return
		}

		user, err := users.FindByID(c.Request.Context(), userID)
		if err != nil || user == nil || user.IsDeleted {
			c.Next()
			return
		}

		c.Set("user", user)
		c.Next()
	}
}

func ExtractToken(c *gin.Context) string {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}

	cookieToken, err := c.Cookie("jwt")
	if err == nil {
		return strings.TrimSpace(cookieToken)
	}

	return ""
}

func extractUserID(claims jwt.MapClaims) (primitive.ObjectID, error) {
	for _, key := range []string{"userId", "_id", "id"} {
		raw, exists := claims[key]
		if !exists {
			continue
		}

		switch value := raw.(type) {
		case string:
			return primitive.ObjectIDFromHex(value)
		case primitive.ObjectID:
			return value, nil
		}
	}

	return primitive.NilObjectID, errors.New("user id not found")
}

func isAdmin(user *User) bool {
	if user == nil {
		return false
	}
	if user.IsAdmin || user.IsSuperUser || user.IsSuperAdmin {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(user.Role), "admin")
}

func CurrentUser(c *gin.Context) (*User, bool) {
	value, exists := c.Get("user")
	if !exists || value == nil {
		return nil, false
	}

	user, ok := value.(*User)
	return user, ok && user != nil
}

func authenticateUser(c *gin.Context, secret string, users UserStore) (*User, bool) {
	if strings.TrimSpace(secret) == "" {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "JWT_SECRET is not configured"})
		return nil, false
	}

	tokenValue := ExtractToken(c)
	if tokenValue == "" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Not authorized - no token"})
		return nil, false
	}

	token, err := jwt.Parse(tokenValue, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authorized - token invalid/expired"})
		return nil, false
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authorized - invalid claims"})
		return nil, false
	}

	userID, err := extractUserID(claims)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authorized - user id missing"})
		return nil, false
	}

	user, err := users.FindByID(c.Request.Context(), userID)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user"})
		return nil, false
	}
	if user == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Not authorized - user not found"})
		return nil, false
	}
	if user.IsDeleted {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Account disabled"})
		return nil, false
	}

	c.Set("user", user)
	return user, true
}
