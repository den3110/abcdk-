package recordings

import "github.com/gin-gonic/gin"

type Dependencies struct {
	Repository Repository
	Store      Store
}

type Module struct {
	handler *Handler
}

func New(deps Dependencies) *Module {
	service := NewService(deps.Repository, deps.Store)
	return &Module{
		handler: NewHandler(service),
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	group.POST("/chunk", m.handler.UploadChunk)
	group.GET("/by-match/:matchId", m.handler.GetRecordingByMatch)
}
