package recordings

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) UploadChunk(c *gin.Context) {
	matchID := c.PostForm("matchId")
	if matchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "matchId required"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "cannot open file", "detail": err.Error()})
		return
	}
	defer file.Close()

	response, err := h.service.SaveChunk(c.Request.Context(), SaveChunkInput{
		MatchID:    matchID,
		ChunkIndex: c.PostForm("chunkIndex"),
		IsFinal:    toBool(c.PostForm("isFinal")),
		File:       file,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrMissingMatchID), errors.Is(err, ErrInvalidMatchID), errors.Is(err, ErrInvalidChunk):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrMissingFile):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "upload failed", "detail": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, response)
}

func (h *Handler) GetRecordingByMatch(c *gin.Context) {
	matchID := c.Param("matchId")
	if matchID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "matchId is required"})
		return
	}

	response, err := h.service.GetRecordingByMatch(c.Request.Context(), matchID)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidMatchID):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		case errors.Is(err, ErrRecordingMissing):
			c.JSON(http.StatusNotFound, gin.H{"message": "No recording for this match"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Get recording failed", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, response)
}

func toBool(raw string) bool {
	switch raw {
	case "1", "true", "TRUE", "True", "yes", "YES", "y", "Y":
		return true
	default:
		return false
	}
}
