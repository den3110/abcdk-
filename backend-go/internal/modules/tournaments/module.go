package tournaments

import (
	"errors"
	"net/http"

	"backendgo/internal/infra/auth"

	"github.com/gin-gonic/gin"
)

type Dependencies struct {
	Repository   *MongoRepository
	OptionalAuth gin.HandlerFunc
}

type Module struct {
	handler      *Handler
	optionalAuth gin.HandlerFunc
}

func New(deps Dependencies) *Module {
	return &Module{
		handler:      NewHandler(NewService(deps.Repository)),
		optionalAuth: deps.OptionalAuth,
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	public := group.Group("")
	if m.optionalAuth != nil {
		public.Use(m.optionalAuth)
	}

	public.GET("/matches/:matchId", m.handler.GetMatchPublic)
	public.GET("/:id/brackets", m.handler.ListBrackets)
	public.GET("/:id/matches", m.handler.ListMatches)
	public.GET("/", m.handler.List)
	public.GET("/search", m.handler.Search)
	public.GET("/:id", m.handler.GetByID)
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(c *gin.Context) {
	payload, err := h.service.List(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to list tournaments", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) Search(c *gin.Context) {
	payload, err := h.service.Search(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to search tournaments", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) GetByID(c *gin.Context) {
	payload, err := h.service.GetByID(c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid ID"})
		case errors.Is(err, ErrTournamentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "Tournament not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load tournament", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) ListBrackets(c *gin.Context) {
	payload, err := h.service.ListBrackets(c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid tournament id"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load brackets", "error": err.Error()})
		}
		return
	}
	c.Header("Cache-Control", "public, max-age=10, stale-while-revalidate=20")
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) ListMatches(c *gin.Context) {
	payload, err := h.service.ListMatches(c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid tournament id"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load matches", "error": err.Error()})
		}
		return
	}
	if view := c.Query("view"); view == "bracket" || view == "schedule" {
		c.Header("Cache-Control", "public, max-age=2, stale-while-revalidate=5")
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) GetMatchPublic(c *gin.Context) {
	payload, err := h.service.GetMatchPublic(c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidMatchID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid match id"})
		case errors.Is(err, ErrMatchNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "Match not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load match", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}

func currentUserID(c *gin.Context) string {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		return ""
	}
	return user.ID.Hex()
}
