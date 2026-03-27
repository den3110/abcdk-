package app

import (
	"net/http"
	"strings"

	"backendgo/internal/config"
	"backendgo/internal/infra/auth"
	"backendgo/internal/modules/adminsystem"
	"backendgo/internal/modules/authapi"
	"backendgo/internal/modules/recordings"
	"backendgo/internal/modules/recordingsv2"
	"backendgo/internal/modules/registrations"
	"backendgo/internal/modules/systemsettings"
	"backendgo/internal/modules/tournaments"
	"backendgo/internal/modules/users"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/mongo"
)

func NewRouter(cfg config.Config, db *mongo.Database) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())
	engine.MaxMultipartMemory = 8 << 20

	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"port":   cfg.Port,
		})
	})
	engine.Any("/graphql", func(c *gin.Context) {
		mode := strings.ToLower(strings.TrimSpace(cfg.GraphQLDeprecationMode))
		switch mode {
		case "410", "gone", "removed":
			c.Header("X-GraphQL-Status", "removed")
			c.JSON(http.StatusGone, gin.H{
				"ok":      false,
				"message": "GraphQL has been removed from backend-go after the cutover audit window",
			})
		default:
			c.Header("X-GraphQL-Status", "audit-required")
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"ok":      false,
				"message": "GraphQL is not available in backend-go until the production access audit is completed",
				"mode":    cfg.GraphQLDeprecationMode,
			})
		}
	})

	api := engine.Group("/api")

	userStore := auth.NewMongoUserStore(db.Collection("users"))
	settingsRepository := systemsettings.NewMongoRepository(db)

	authModule := authapi.New(authapi.Dependencies{
		Settings:       settingsRepository,
		AuthMiddleware: auth.RequireUser(cfg.JWTSecret, userStore),
	})
	authModule.Register(api.Group("/auth"))

	usersModule := users.New(users.Dependencies{
		Repository:     users.NewMongoRepository(db),
		Settings:       settingsRepository,
		AuthMiddleware: auth.RequireUser(cfg.JWTSecret, userStore),
		JWTSecret:      cfg.JWTSecret,
		NodeEnv:        cfg.NodeEnv,
	})
	usersModule.Register(api.Group("/users"))

	tournamentsModule := tournaments.New(tournaments.Dependencies{
		Repository:   tournaments.NewMongoRepository(db),
		OptionalAuth: auth.OptionalUser(cfg.JWTSecret, userStore),
	})
	tournamentsModule.Register(api.Group("/tournaments"))

	registrationsModule := registrations.New(registrations.Dependencies{
		Repository:     registrations.NewMongoRepository(db),
		AuthMiddleware: auth.RequireUser(cfg.JWTSecret, userStore),
		OptionalAuth:   auth.OptionalUser(cfg.JWTSecret, userStore),
	})
	registrationsModule.RegisterTournamentRoutes(api.Group("/tournaments"))
	registrationsModule.RegisterRegistrationRoutes(api.Group("/registrations"))

	adminModule := adminsystem.New(adminsystem.Dependencies{
		AuthMiddleware: auth.RequireAdmin(cfg.JWTSecret, userStore),
	})
	adminModule.Register(api.Group("/admin/system"))

	recordingsModule := recordings.New(recordings.Dependencies{
		Repository: recordings.NewMongoRepository(db),
		Store:      recordings.NewDiskStore(cfg.UploadsDir),
	})
	recordingsModule.Register(api.Group("/live/recordings"))

	recordingsV2Module := recordingsv2.New(recordingsv2.Dependencies{
		Repository:      recordingsv2.NewMongoRepository(db),
		Storage:         recordingsv2.NewR2StorageDriver(),
		AuthMiddleware:  auth.RequireUser(cfg.JWTSecret, userStore),
		AdminMiddleware: auth.RequireAdmin(cfg.JWTSecret, userStore),
	})
	recordingsV2Module.Register(api.Group("/live/recordings/v2"))

	return engine
}
