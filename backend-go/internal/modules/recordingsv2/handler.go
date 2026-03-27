package recordingsv2

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

func (h *Handler) GetRecordingByMatch(c *gin.Context) {
	payload, err := h.service.GetRecordingByMatch(c.Request.Context(), c.Param("matchId"))
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidMatchID):
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		case errors.Is(err, ErrRecordingNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to get recording", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) PlayRecording(c *gin.Context) {
	decision, err := h.service.PlayRecording(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	if decision.RedirectURL != "" {
		c.Redirect(http.StatusFound, decision.RedirectURL)
		return
	}
	c.JSON(decision.StatusCode, decision.Payload)
}

func (h *Handler) PlayAICommentary(c *gin.Context) {
	decision, err := h.service.PlayAICommentary(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	if decision.RedirectURL != "" {
		c.Redirect(http.StatusFound, decision.RedirectURL)
		return
	}
	c.JSON(decision.StatusCode, decision.Payload)
}

func (h *Handler) GetRawStatus(c *gin.Context) {
	payload, statusCode, err := h.service.GetRawStatus(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	c.JSON(statusCode, payload)
}

func (h *Handler) renderRecordingError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidRecordingID):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	case errors.Is(err, ErrRecordingNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Recording request failed", "error": err.Error()})
	}
}
