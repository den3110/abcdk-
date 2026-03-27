package recordings

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func TestRecordingsHTTPWithMongo(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("BACKEND_GO_TEST_MONGO_URI"))
	if uri == "" {
		uri = strings.TrimSpace(os.Getenv("MONGO_URI"))
	}
	if uri == "" {
		t.Skip("mongo uri not configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Skipf("mongo unavailable: %v", err)
	}
	defer client.Disconnect(context.Background())

	dbName := fmt.Sprintf("backend_go_test_%d", time.Now().UnixNano())
	database := client.Database(dbName)
	t.Cleanup(func() {
		_ = database.Drop(context.Background())
	})

	module := New(Dependencies{
		Repository: NewMongoRepository(database),
		Store:      NewDiskStore(t.TempDir()),
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	module.Register(router.Group("/api/live/recordings"))

	matchID := primitive.NewObjectID().Hex()

	postChunk := func(chunkIndex string, isFinal bool, content string) *httptest.ResponseRecorder {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField("matchId", matchID)
		_ = writer.WriteField("chunkIndex", chunkIndex)
		_ = writer.WriteField("isFinal", fmt.Sprintf("%t", isFinal))
		fileWriter, _ := writer.CreateFormFile("file", "chunk.mp4")
		_, _ = fileWriter.Write([]byte(content))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/live/recordings/chunk", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())

		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	if response := postChunk("0", false, "hello"); response.Code != http.StatusOK {
		t.Fatalf("expected first upload 200, got %d body=%s", response.Code, response.Body.String())
	}
	if response := postChunk("0", false, "hello-updated"); response.Code != http.StatusOK {
		t.Fatalf("expected repeated upload 200, got %d body=%s", response.Code, response.Body.String())
	}
	if response := postChunk("1", true, "world"); response.Code != http.StatusOK {
		t.Fatalf("expected final upload 200, got %d body=%s", response.Code, response.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/live/recordings/by-match/"+matchID, nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected get by match 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload RecordingResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Recording == nil {
		t.Fatal("expected recording payload")
	}
	if payload.Recording.Status != "merging" || !payload.Recording.HasFinalChunk {
		t.Fatalf("unexpected recording state: %#v", payload.Recording)
	}
	if payload.Recording.TotalChunks != 2 {
		t.Fatalf("expected 2 chunks, got %d", payload.Recording.TotalChunks)
	}
	if len(payload.Chunks) != 2 {
		t.Fatalf("expected 2 chunk rows, got %d", len(payload.Chunks))
	}
}
