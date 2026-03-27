package runtime

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type BackgroundServiceSpec struct {
	Name         string
	Role         string
	Port         string
	TickInterval time.Duration
	TickTimeout  time.Duration
	OnTick       func(context.Context, *Bundle) error
}

func RunBackgroundService(ctx context.Context, bundle *Bundle, spec BackgroundServiceSpec) error {
	if spec.TickInterval <= 0 {
		spec.TickInterval = 30 * time.Second
	}
	if spec.TickTimeout <= 0 {
		spec.TickTimeout = spec.TickInterval
	}

	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())
	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":      "ok",
			"name":        spec.Name,
			"role":        spec.Role,
			"port":        spec.Port,
			"mongoDb":     bundle.Config.MongoDatabase,
			"redisReady":  bundle.Config.RedisURL != "",
			"serviceName": spec.Name,
			"startedAt":   bundle.StartedAt,
		})
	})
	engine.GET("/readyz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":    "ready",
			"name":      spec.Name,
			"role":      spec.Role,
			"startedAt": bundle.StartedAt,
		})
	})

	if spec.OnTick != nil {
		go func() {
			ticker := time.NewTicker(spec.TickInterval)
			defer ticker.Stop()

			runTick := func() {
				tickCtx, cancel := context.WithTimeout(context.Background(), spec.TickTimeout)
				defer cancel()
				if err := spec.OnTick(tickCtx, bundle); err != nil {
					log.Printf("%s tick error: %v", spec.Name, err)
				}
			}

			runTick()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					runTick()
				}
			}
		}()
	}

	return RunHTTPServer(ctx, spec.Name, spec.Port, engine)
}
