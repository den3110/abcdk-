package recordingsv2

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) StartRecording(c *gin.Context) {
	var input StartRecordingInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.StartRecording(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to start recording")
}

func (h *Handler) PresignSegment(c *gin.Context) {
	var input PresignSegmentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.PresignSegment(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to presign segment")
}

func (h *Handler) PresignSegmentBatch(c *gin.Context) {
	var input PresignBatchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.PresignSegmentBatch(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to presign segment batch")
}

func (h *Handler) PresignLiveManifest(c *gin.Context) {
	var payload struct {
		RecordingID string `json:"recordingId"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	body, statusCode, err := h.service.PresignLiveManifest(c.Request.Context(), payload.RecordingID)
	h.renderWriteResponse(c, body, statusCode, err, "Failed to presign live manifest")
}

func (h *Handler) StartMultipartSegment(c *gin.Context) {
	var input PresignSegmentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.StartMultipartSegment(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to start multipart segment")
}

func (h *Handler) PresignMultipartPart(c *gin.Context) {
	var input MultipartPartInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.PresignMultipartPart(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to presign multipart part")
}

func (h *Handler) ReportMultipartProgress(c *gin.Context) {
	var input MultipartProgressInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.ReportMultipartProgress(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to report multipart progress")
}

func (h *Handler) CompleteMultipartSegment(c *gin.Context) {
	var input CompleteMultipartInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.CompleteMultipartSegment(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to complete multipart segment")
}

func (h *Handler) AbortMultipartSegment(c *gin.Context) {
	var input struct {
		RecordingID  string `json:"recordingId"`
		SegmentIndex int    `json:"segmentIndex"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.AbortMultipartSegment(c.Request.Context(), input.RecordingID, input.SegmentIndex)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to abort multipart segment")
}

func (h *Handler) CompleteSegment(c *gin.Context) {
	var input CompleteSegmentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.CompleteSegment(c.Request.Context(), input)
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to complete segment")
}

func (h *Handler) FinalizeRecording(c *gin.Context) {
	var input struct {
		RecordingID string `json:"recordingId"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
		return
	}
	payload, statusCode, err := h.service.FinalizeRecording(c.Request.Context(), input.RecordingID, false, "recording_export_queued")
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to finalize recording")
}

func (h *Handler) GetWorkerHealth(c *gin.Context) {
	payload, statusCode, err := h.service.GetWorkerHealth(c.Request.Context())
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to get live recording worker health")
}

func (h *Handler) RetryExport(c *gin.Context) {
	payload, statusCode, err := h.service.RetryExport(c.Request.Context(), c.Param("id"))
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to retry recording export")
}

func (h *Handler) ForceExport(c *gin.Context) {
	payload, statusCode, err := h.service.ForceExport(c.Request.Context(), c.Param("id"))
	h.renderWriteResponse(c, payload, statusCode, err, "Failed to force recording export")
}

func (h *Handler) GetTemporaryPlaylist(c *gin.Context) {
	payload, statusCode, headers, err := h.service.GetTemporaryPlaylist(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	for key, values := range headers {
		for _, value := range values {
			c.Header(key, value)
		}
	}
	c.JSON(statusCode, payload)
}

func (h *Handler) GetTemporaryPlayback(c *gin.Context) {
	body, payload, statusCode, headers, err := h.service.GetTemporaryPlaybackPage(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	for key, values := range headers {
		for _, value := range values {
			c.Header(key, value)
		}
	}
	if statusCode == http.StatusFound {
		location := headers.Get("Location")
		if location != "" {
			c.Redirect(statusCode, location)
			return
		}
		c.Status(statusCode)
		return
	}
	if statusCode == http.StatusConflict {
		c.JSON(statusCode, payload)
		return
	}
	c.Data(statusCode, "text/html; charset=utf-8", []byte(body))
}

func (h *Handler) StreamRawRecording(c *gin.Context) {
	decision, err := h.service.GetRawStreamDecision(c.Request.Context(), c.Param("id"), false, c.GetHeader("Range"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	if decision.Stream != nil {
		h.pipeRawDriveStream(c, decision, c.Param("id"))
		return
	}
	if decision.RedirectURL != "" {
		c.Redirect(http.StatusFound, decision.RedirectURL)
		return
	}
	c.JSON(decision.StatusCode, decision.Payload)
}

func (h *Handler) StreamRawAICommentary(c *gin.Context) {
	decision, err := h.service.GetRawStreamDecision(c.Request.Context(), c.Param("id"), true, c.GetHeader("Range"))
	if err != nil {
		h.renderRecordingError(c, err)
		return
	}
	if decision.Stream != nil {
		h.pipeRawDriveStream(c, decision, c.Param("id"))
		return
	}
	if decision.RedirectURL != "" {
		c.Redirect(http.StatusFound, decision.RedirectURL)
		return
	}
	c.JSON(decision.StatusCode, decision.Payload)
}

func (h *Handler) renderWriteResponse(c *gin.Context, payload map[string]any, statusCode int, err error, fallbackMessage string) {
	if err == nil {
		if payload == nil {
			switch statusCode {
			case http.StatusBadRequest:
				payload = gin.H{"message": ErrInvalidRecordingID.Error()}
			case http.StatusNotFound:
				payload = gin.H{"message": ErrRecordingNotFound.Error()}
			case http.StatusServiceUnavailable:
				payload = gin.H{"message": ErrStorageNotReady.Error()}
			default:
				payload = gin.H{"message": fallbackMessage}
				if statusCode == 0 {
					statusCode = http.StatusInternalServerError
				}
			}
		}
		if statusCode == 0 {
			statusCode = http.StatusOK
		}
		c.JSON(statusCode, payload)
		return
	}
	switch {
	case errors.Is(err, ErrInvalidRecordingID):
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
	case errors.Is(err, ErrRecordingNotFound):
		c.JSON(http.StatusNotFound, gin.H{"message": err.Error()})
	case errors.Is(err, ErrStorageNotReady):
		c.JSON(http.StatusServiceUnavailable, gin.H{"message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": fallbackMessage, "error": err.Error()})
	}
}

func (h *Handler) pipeRawDriveStream(c *gin.Context, decision *RedirectDecision, recordingID string) {
	if decision == nil || decision.Stream == nil || decision.Stream.Body == nil {
		c.JSON(http.StatusBadGateway, gin.H{"ok": false, "message": "Raw stream response is invalid"})
		return
	}
	defer decision.Stream.Body.Close()

	applyRawVideoHeaders(c.Writer.Header(), decision.Stream.Headers, decision.FileLabel, decision.Stream.DriveAuthMode)
	applyRawVideoFallbackRangeHeaders(c.Writer.Header(), c.GetHeader("Range"), decision.FallbackSizeBytes)

	statusCode := decision.Stream.StatusCode
	if statusCode == 0 {
		if c.GetHeader("Range") != "" {
			statusCode = http.StatusPartialContent
		} else {
			statusCode = http.StatusOK
		}
	}
	c.Status(statusCode)
	if _, err := io.Copy(c.Writer, decision.Stream.Body); err != nil {
		c.Error(err)
	}
}
