package programs

import (
	"context"
	"time"

	"backendgo/internal/app"
	"backendgo/internal/runtime"
)

func RunAPI(ctx context.Context) error {
	bundle, err := runtime.Bootstrap(ctx)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = bundle.Close(closeCtx)
	}()

	router := app.NewRouter(bundle.Config, bundle.Database)
	return runtime.RunHTTPServer(ctx, bundle.Config.ServicePrefix+"-api", bundle.Config.APIPort, router)
}
