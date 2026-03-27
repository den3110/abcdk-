package registrations

import (
	"errors"
	"net/http"

	"backendgo/internal/infra/auth"

	"github.com/gin-gonic/gin"
)

type Dependencies struct {
	Repository     Repository
	AuthMiddleware gin.HandlerFunc
	OptionalAuth   gin.HandlerFunc
}

type Module struct {
	handler        *Handler
	authMiddleware gin.HandlerFunc
	optionalAuth   gin.HandlerFunc
}

func New(deps Dependencies) *Module {
	return &Module{
		handler:        NewHandler(NewService(deps.Repository)),
		authMiddleware: deps.AuthMiddleware,
		optionalAuth:   deps.OptionalAuth,
	}
}

func (m *Module) RegisterTournamentRoutes(group *gin.RouterGroup) {
	public := group.Group("/:id/registrations")
	if m.optionalAuth != nil {
		public.Use(m.optionalAuth)
	}
	public.GET("", m.handler.GetRegistrations)

	protected := group.Group("/:id/registrations")
	if m.authMiddleware != nil {
		protected.Use(m.authMiddleware)
	}
	protected.POST("", m.handler.CreateRegistration)
}

func (m *Module) RegisterRegistrationRoutes(group *gin.RouterGroup) {
	search := group.Group("")
	if m.optionalAuth != nil {
		search.Use(m.optionalAuth)
	}
	search.GET("/:id/registrations/search", m.handler.SearchRegistrations)

	protected := group.Group("")
	if m.authMiddleware != nil {
		protected.Use(m.authMiddleware)
	}
	protected.PATCH("/:regId/checkin", m.handler.CheckinRegistration)
	protected.POST("/:regId/cancel", m.handler.CancelRegistration)
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetRegistrations(c *gin.Context) {
	payload, err := h.service.GetRegistrations(c.Request.Context(), c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid tournament id"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load registrations", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) SearchRegistrations(c *gin.Context) {
	payload, err := h.service.SearchRegistrations(c.Request.Context(), c)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid tournament id"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to search registrations", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) CreateRegistration(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Unauthorized"})
		return
	}

	var request struct {
		Message       string `json:"message"`
		Player1ID     string `json:"player1Id"`
		Player2ID     string `json:"player2Id"`
		TeamFactionID string `json:"teamFactionId"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request body", "error": err.Error()})
		return
	}

	payload, err := h.service.CreateRegistration(c.Request.Context(), c.Param("id"), user, CreateRegistrationInput{
		Message:       request.Message,
		Player1ID:     request.Player1ID,
		Player2ID:     request.Player2ID,
		TeamFactionID: request.TeamFactionID,
	})
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr != nil {
			c.JSON(httpErr.StatusCode, gin.H{"message": httpErr.Message})
			return
		}
		switch {
		case errors.Is(err, ErrInvalidTournamentID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid tournament id"})
		case errors.Is(err, ErrTournamentNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "Tournament not found"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Create registration failed", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, payload)
}

func (h *Handler) CheckinRegistration(c *gin.Context) {
	payload, err := h.service.CheckinRegistration(c.Request.Context(), c.Param("regId"))
	if err != nil {
		switch {
		case errors.Is(err, ErrRegistrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "Registration not found"})
		case errors.Is(err, ErrInvalidRegistrationID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Registration id is invalid"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Checkin failed", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) CancelRegistration(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Unauthorized"})
		return
	}

	payload, err := h.service.CancelRegistration(c.Request.Context(), c.Param("regId"), user.ID)
	if err != nil {
		var httpErr *HTTPError
		if errors.As(err, &httpErr) && httpErr != nil {
			c.JSON(httpErr.StatusCode, gin.H{"message": httpErr.Message})
			return
		}
		switch {
		case errors.Is(err, ErrRegistrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"message": "Registration not found"})
		case errors.Is(err, ErrInvalidRegistrationID):
			c.JSON(http.StatusBadRequest, gin.H{"message": "Registration id is invalid"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Cancel registration failed", "error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, payload)
}
