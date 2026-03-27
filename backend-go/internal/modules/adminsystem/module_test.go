package adminsystem

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type fakeRunner struct{}

func (fakeRunner) Command(_ context.Context, _ string, _ ...string) ([]byte, error) {
	return []byte("command output"), nil
}

func (fakeRunner) Shell(_ context.Context, _ string) ([]byte, error) {
	return []byte("shell output"), nil
}

func TestCommandsEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)

	module := New(Dependencies{
		AuthMiddleware: func(c *gin.Context) { c.Next() },
		Runner:         fakeRunner{},
	})

	router := gin.New()
	module.Register(router.Group("/api/admin/system"))

	t.Run("get commands", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/admin/system/commands", nil)
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", recorder.Code)
		}

		var payload []map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if len(payload) == 0 {
			t.Fatal("expected at least one safe command")
		}
	})

	t.Run("exec command", func(t *testing.T) {
		body := bytes.NewBufferString(`{"cmdKey":"df"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/admin/system/exec", body)
		req.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()

		router.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", recorder.Code)
		}

		var payload map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if payload["cmdKey"] != "df" {
			t.Fatalf("expected cmdKey df, got %#v", payload["cmdKey"])
		}
		if payload["output"] != "shell output" {
			t.Fatalf("expected shell output, got %#v", payload["output"])
		}
	})
}
