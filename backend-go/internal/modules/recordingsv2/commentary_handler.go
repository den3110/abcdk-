package recordingsv2

import (
	"net/http"
	"strings"

	"backendgo/internal/infra/auth"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
)

func (h *Handler) GetMonitorSnapshot(c *gin.Context) {
	payload, statusCode, err := h.service.GetMonitorSnapshot(c.Request.Context())
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to build recording monitor snapshot")
}

func (h *Handler) GetAICommentaryMonitor(c *gin.Context) {
	payload, statusCode, err := h.service.GetAICommentaryMonitor(c.Request.Context())
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to build AI commentary monitor")
}

func (h *Handler) QueueAICommentary(c *gin.Context) {
	payload, statusCode, err := h.service.QueueAICommentary(c.Request.Context(), c.Param("id"), requestedByFromContext(c), false)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to queue AI commentary")
}

func (h *Handler) RerenderAICommentary(c *gin.Context) {
	payload, statusCode, err := h.service.QueueAICommentary(c.Request.Context(), c.Param("id"), requestedByFromContext(c), true)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to rerender AI commentary")
}

func requestedByFromContext(c *gin.Context) bson.M {
	userValue, exists := c.Get("user")
	if !exists {
		return bson.M{"userId": nil, "name": "", "email": ""}
	}
	user, ok := userValue.(*auth.User)
	if !ok || user == nil {
		return bson.M{"userId": nil, "name": "", "email": ""}
	}
	return bson.M{
		"userId": user.ID,
		"name":   firstNonEmptyString(strings.TrimSpace(user.FullName), strings.TrimSpace(user.Name)),
		"email":  strings.TrimSpace(user.Email),
	}
}

func (h *Handler) renderJSONMessage(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, gin.H{"message": message})
}

func (h *Handler) renderConflict(c *gin.Context, message string) {
	h.renderJSONMessage(c, http.StatusConflict, message)
}
