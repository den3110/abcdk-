package authapi

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"backendgo/internal/infra/auth"
	"backendgo/internal/modules/systemsettings"

	"github.com/gin-gonic/gin"
)

type Dependencies struct {
	Settings       systemsettings.Repository
	AuthMiddleware gin.HandlerFunc
}

type Module struct {
	handler        *Handler
	authMiddleware gin.HandlerFunc
}

func New(deps Dependencies) *Module {
	service := NewService(deps.Settings)
	return &Module{
		handler:        NewHandler(service),
		authMiddleware: deps.AuthMiddleware,
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	protected := group.Group("")
	if m.authMiddleware != nil {
		protected.Use(m.authMiddleware)
	}

	protected.GET("/verify", m.handler.Verify)
	protected.POST("/logout", m.handler.Logout)

	group.GET("/system/registration", m.handler.GetRegistrationSettings)
	group.GET("/system/ota/allowed", m.handler.GetOTAAllowed)
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Verify(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Not authorized"})
		return
	}

	if !hasAllowedRole(user, "admin", "referee") {
		c.JSON(http.StatusForbidden, gin.H{"message": "Forbidden - insufficient role"})
		return
	}

	c.JSON(http.StatusOK, h.service.VerifyPayload(user))
}

func (h *Handler) Logout(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Not authorized"})
		return
	}

	if !hasAllowedRole(user, "admin") {
		c.JSON(http.StatusForbidden, gin.H{"message": "Forbidden - insufficient role"})
		return
	}

	auth.ClearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func (h *Handler) GetRegistrationSettings(c *gin.Context) {
	payload, err := h.service.RegistrationSettings(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load registration settings", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) GetOTAAllowed(c *gin.Context) {
	payload, err := h.service.OTAAllowed(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load ota settings", "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payload)
}

type Service struct {
	settings systemsettings.Repository
}

func NewService(settings systemsettings.Repository) *Service {
	return &Service{settings: settings}
}

func (s *Service) VerifyPayload(user *auth.User) gin.H {
	isSuperUser := user != nil && (user.IsSuperUser || user.IsSuperAdmin)

	roles := make(map[string]struct{})
	if user != nil {
		for _, role := range user.Roles {
			role = normalizeRole(role)
			if role != "" {
				roles[role] = struct{}{}
			}
		}
		if role := normalizeRole(user.Role); role != "" {
			roles[role] = struct{}{}
		}
		if user.IsAdmin {
			roles["admin"] = struct{}{}
		}
		if isSuperUser {
			roles["admin"] = struct{}{}
			roles["superadmin"] = struct{}{}
			roles["superuser"] = struct{}{}
		}
	}

	roleList := make([]string, 0, len(roles))
	for role := range roles {
		roleList = append(roleList, role)
	}
	sort.Strings(roleList)

	return gin.H{
		"_id":          user.ID,
		"name":         user.Name,
		"email":        user.Email,
		"role":         user.Role,
		"roles":        roleList,
		"isSuperUser":  isSuperUser,
		"isSuperAdmin": isSuperUser,
	}
}

func (s *Service) RegistrationSettings(ctx context.Context) (gin.H, error) {
	doc, err := s.settings.GetOrCreate(ctx)
	if err != nil {
		return nil, err
	}

	return gin.H{
		"open":                         systemsettings.RegistrationOpen(doc),
		"requireOptionalProfileFields": systemsettings.RegistrationRequireOptionalProfileFields(doc),
	}, nil
}

func (s *Service) OTAAllowed(ctx context.Context) (gin.H, error) {
	doc, err := s.settings.GetOrCreate(ctx)
	if err != nil {
		return nil, err
	}

	return gin.H{"allowed": systemsettings.OTAAllowed(doc)}, nil
}

func hasAllowedRole(user *auth.User, allowed ...string) bool {
	if user == nil {
		return false
	}

	set := make(map[string]struct{})
	for _, role := range user.Roles {
		role = normalizeRole(role)
		if role != "" {
			set[role] = struct{}{}
		}
	}

	if role := normalizeRole(user.Role); role != "" {
		set[role] = struct{}{}
	}
	if user.IsAdmin {
		set["admin"] = struct{}{}
	}
	if user.IsSuperUser || user.IsSuperAdmin {
		set["admin"] = struct{}{}
		set["superadmin"] = struct{}{}
		set["superuser"] = struct{}{}
	}

	for _, role := range allowed {
		if _, ok := set[normalizeRole(role)]; ok {
			return true
		}
	}

	return false
}

func normalizeRole(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
