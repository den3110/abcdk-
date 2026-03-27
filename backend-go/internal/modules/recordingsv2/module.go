package recordingsv2

import "github.com/gin-gonic/gin"

type Dependencies struct {
	Repository      Repository
	Storage         StorageDriver
	AuthMiddleware  gin.HandlerFunc
	AdminMiddleware gin.HandlerFunc
}

type Module struct {
	handler         *Handler
	authMiddleware  gin.HandlerFunc
	adminMiddleware gin.HandlerFunc
}

func New(deps Dependencies) *Module {
	service := NewService(deps.Repository, deps.Storage)
	return &Module{
		handler:         NewHandler(service),
		authMiddleware:  deps.AuthMiddleware,
		adminMiddleware: deps.AdminMiddleware,
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	writeGroup := group
	if m.authMiddleware != nil {
		writeGroup = group.Group("")
		writeGroup.Use(m.authMiddleware)
	}
	writeGroup.POST("/start", m.handler.StartRecording)
	writeGroup.POST("/segments/presign-batch", m.handler.PresignSegmentBatch)
	writeGroup.POST("/segments/presign", m.handler.PresignSegment)
	writeGroup.POST("/live-manifest/presign", m.handler.PresignLiveManifest)
	writeGroup.POST("/segments/multipart/start", m.handler.StartMultipartSegment)
	writeGroup.POST("/segments/multipart/part-url", m.handler.PresignMultipartPart)
	writeGroup.POST("/segments/multipart/progress", m.handler.ReportMultipartProgress)
	writeGroup.POST("/segments/multipart/complete", m.handler.CompleteMultipartSegment)
	writeGroup.POST("/segments/multipart/abort", m.handler.AbortMultipartSegment)
	writeGroup.POST("/segments/complete", m.handler.CompleteSegment)
	writeGroup.POST("/finalize", m.handler.FinalizeRecording)

	admin := group.Group("/admin")
	if m.adminMiddleware != nil {
		admin.Use(m.adminMiddleware)
	}
	admin.GET("/monitor", m.handler.GetMonitorSnapshot)
	admin.GET("/worker-health", m.handler.GetWorkerHealth)
	admin.GET("/commentary/monitor", m.handler.GetAICommentaryMonitor)
	admin.POST("/:id/retry-export", m.handler.RetryExport)
	admin.POST("/:id/force-export", m.handler.ForceExport)
	admin.POST("/:id/commentary", m.handler.QueueAICommentary)
	admin.POST("/:id/commentary/rerender", m.handler.RerenderAICommentary)

	group.GET("/by-match/:matchId", m.handler.GetRecordingByMatch)
	group.GET("/:id/temp/playlist", m.handler.GetTemporaryPlaylist)
	group.GET("/:id/temp", m.handler.GetTemporaryPlayback)
	group.GET("/:id/play", m.handler.PlayRecording)
	group.GET("/:id/commentary/play", m.handler.PlayAICommentary)
	group.GET("/:id/raw", m.handler.StreamRawRecording)
	group.GET("/:id/commentary/raw", m.handler.StreamRawAICommentary)
	group.GET("/:id/raw/status", m.handler.GetRawStatus)
}
