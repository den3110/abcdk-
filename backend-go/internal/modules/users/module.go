package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"backendgo/internal/infra/auth"
	"backendgo/internal/modules/systemsettings"

	"github.com/gin-gonic/gin"
)

type Dependencies struct {
	Repository     Repository
	Settings       systemsettings.Repository
	AuthMiddleware gin.HandlerFunc
	JWTSecret      string
	NodeEnv        string
}

type Module struct {
	handler        *Handler
	authMiddleware gin.HandlerFunc
}

func New(deps Dependencies) *Module {
	service := NewService(deps.Repository, deps.Settings, deps.JWTSecret, deps.NodeEnv)
	return &Module{
		handler:        NewHandler(service),
		authMiddleware: deps.AuthMiddleware,
	}
}

func (m *Module) Register(group *gin.RouterGroup) {
	group.POST("/", m.handler.Register)
	group.POST("/auth/web", m.handler.LoginWeb)
	group.POST("/logout", m.handler.Logout)
	group.GET("/search", m.handler.SearchUsers)

	protected := group.Group("")
	if m.authMiddleware != nil {
		protected.Use(m.authMiddleware)
	}
	protected.GET("/me", m.handler.GetMe)
	protected.GET("/reauth", m.handler.Reauth)
	protected.GET("/profile", m.handler.GetProfile)
	protected.PUT("/profile", m.handler.UpdateProfile)
	protected.GET("/tournaments", m.handler.ListMyTournaments)
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Register(c *gin.Context) {
	var request struct {
		Name       string          `json:"name"`
		Nickname   string          `json:"nickname"`
		Phone      string          `json:"phone"`
		DOB        string          `json:"dob"`
		Email      string          `json:"email"`
		Password   string          `json:"password"`
		CCCD       string          `json:"cccd"`
		Avatar     string          `json:"avatar"`
		Province   string          `json:"province"`
		Gender     string          `json:"gender"`
		CCCDImages json.RawMessage `json:"cccdImages"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request body", "error": err.Error()})
		return
	}

	statusCode, payload, err := h.service.Register(c.Request.Context(), c, RegisterInput{
		Name:        request.Name,
		Nickname:    request.Nickname,
		Phone:       request.Phone,
		DOB:         request.DOB,
		Email:       request.Email,
		Password:    request.Password,
		CCCD:        request.CCCD,
		Avatar:      request.Avatar,
		Province:    request.Province,
		Gender:      request.Gender,
		CCCDImages:  request.CCCDImages,
		RequestMeta: requestMetaFromContext(c),
	})
	if err != nil {
		renderServiceError(c, err)
		return
	}

	c.JSON(statusCode, payload)
}

func (h *Handler) LoginWeb(c *gin.Context) {
	var request struct {
		Phone      string `json:"phone"`
		Email      string `json:"email"`
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request body", "error": err.Error()})
		return
	}

	payload, err := h.service.LoginWeb(c.Request.Context(), c, LoginInput{
		Phone:       request.Phone,
		Email:       request.Email,
		Identifier:  request.Identifier,
		Password:    request.Password,
		RequestMeta: requestMetaFromContext(c),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrAccountNotFound):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "Tai khoan khong ton tai"})
		case errors.Is(err, ErrInvalidCredentials):
			c.JSON(http.StatusUnauthorized, gin.H{"message": "So dien thoai/email hoac mat khau khong dung"})
		case errors.Is(err, ErrAccountDisabled):
			c.JSON(http.StatusForbidden, gin.H{"message": "Tai khoan khong kha dung"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Login failed", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) Logout(c *gin.Context) {
	auth.ClearSessionCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

func (h *Handler) GetMe(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Khong xac thuc"})
		return
	}

	payload, err := h.service.GetMe(c.Request.Context(), user.ID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "Khong tim thay nguoi dung"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Failed to load profile", "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) Reauth(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Khong xac thuc duoc nguoi dung"})
		return
	}

	payload, err := h.service.Reauth(c.Request.Context(), c, user.ID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			c.JSON(http.StatusForbidden, gin.H{"message": "Tai khoan khong kha dung"})
		case errors.Is(err, ErrAccountDisabled):
			c.JSON(http.StatusForbidden, gin.H{"message": "Tai khoan khong kha dung"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"message": "Reauth failed", "error": err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) GetProfile(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Unauthorized"})
		return
	}

	payload, err := h.service.GetProfile(c.Request.Context(), c, user.ID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "User not found"})
			return
		}
		renderHTTPError(c, err, "Failed to load user profile")
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	var request map[string]json.RawMessage
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "Invalid request body", "error": err.Error()})
		return
	}

	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Unauthorized"})
		return
	}

	input := UpdateProfileInput{
		Name:      optionalString(request["name"]),
		Nickname:  optionalString(request["nickname"]),
		Phone:     optionalString(request["phone"]),
		DOB:       optionalString(request["dob"]),
		Province:  optionalString(request["province"]),
		CCCD:      optionalString(request["cccd"]),
		Email:     optionalString(request["email"]),
		Password:  optionalString(request["password"]),
		Gender:    optionalString(request["gender"]),
		Avatar:    optionalString(request["avatar"]),
		AvatarSet: hasKey(request, "avatar"),
		Cover:     optionalString(request["cover"]),
		CoverSet:  hasKey(request, "cover"),
	}

	payload, err := h.service.UpdateProfile(c.Request.Context(), user.ID, input)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"message": "Khong tim thay nguoi dung"})
			return
		}
		renderHTTPError(c, err, "Cap nhat profile that bai")
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) SearchUsers(c *gin.Context) {
	limit := 10
	if rawLimit := c.Query("limit"); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
			if parsed > 50 {
				parsed = 50
			}
			limit = parsed
		}
	}

	payload, err := h.service.SearchUsers(c.Request.Context(), c.Query("q"), limit)
	if err != nil {
		renderHTTPError(c, err, "Search user failed")
		return
	}

	c.JSON(http.StatusOK, payload)
}

func (h *Handler) ListMyTournaments(c *gin.Context) {
	user, ok := auth.CurrentUser(c)
	if !ok || user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "Unauthorized"})
		return
	}

	page := 1
	if rawPage := c.Query("page"); rawPage != "" {
		if parsed, err := strconv.Atoi(rawPage); err == nil && parsed > 0 {
			page = parsed
		}
	}
	limit := 50
	if rawLimit := c.Query("limit"); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 {
			if parsed > 200 {
				parsed = 200
			}
			limit = parsed
		}
	}
	withMatches := true
	if rawWithMatches := strings.ToLower(strings.TrimSpace(c.Query("withMatches"))); rawWithMatches != "" {
		withMatches = rawWithMatches == "1" || rawWithMatches == "true" || rawWithMatches == "yes"
	}
	matchLimit := 200
	if rawMatchLimit := c.Query("matchLimit"); rawMatchLimit != "" {
		if parsed, err := strconv.Atoi(rawMatchLimit); err == nil && parsed > 0 {
			if parsed > 500 {
				parsed = 500
			}
			matchLimit = parsed
		}
	}

	statuses := []string{}
	if rawStatus := strings.TrimSpace(c.Query("status")); rawStatus != "" {
		for _, item := range strings.Split(strings.ToLower(rawStatus), ",") {
			item = strings.TrimSpace(item)
			if item == "upcoming" || item == "ongoing" || item == "finished" {
				statuses = append(statuses, item)
			}
		}
	}

	payload, err := h.service.ListMyTournaments(c.Request.Context(), user.ID, ListMyTournamentsParams{
		Page:        page,
		Limit:       limit,
		Status:      statuses,
		WithMatches: withMatches,
		MatchLimit:  matchLimit,
	})
	if err != nil {
		renderHTTPError(c, err, "Server error")
		return
	}

	c.JSON(http.StatusOK, payload)
}

func renderServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNicknameRequired):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Biet danh la bat buoc"})
	case errors.Is(err, ErrPasswordTooShort):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Mat khau phai co it nhat 6 ky tu"})
	case errors.Is(err, ErrInvalidEmail):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Email khong hop le"})
	case errors.Is(err, ErrInvalidPhone):
		c.JSON(http.StatusBadRequest, gin.H{"message": "So dien thoai khong hop le"})
	case errors.Is(err, ErrInvalidCCCD):
		c.JSON(http.StatusBadRequest, gin.H{"message": "CCCD phai gom dung 12 chu so"})
	case errors.Is(err, ErrInvalidDOB):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Ngay sinh khong hop le"})
	case errors.Is(err, ErrInvalidGender):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Gioi tinh khong hop le"})
	case errors.Is(err, ErrRegistrationClosed):
		c.JSON(http.StatusForbidden, gin.H{"message": "Dang ky dang tam dong"})
	case errors.Is(err, ErrDuplicateEmail):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Email da ton tai"})
	case errors.Is(err, ErrDuplicatePhone):
		c.JSON(http.StatusBadRequest, gin.H{"message": "So dien thoai da ton tai"})
	case errors.Is(err, ErrDuplicateNickname):
		c.JSON(http.StatusBadRequest, gin.H{"message": "Nickname da ton tai"})
	case errors.Is(err, ErrDuplicateCCCD):
		c.JSON(http.StatusBadRequest, gin.H{"message": "CCCD da duoc su dung cho tai khoan khac"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"message": "Dang ky that bai", "error": err.Error()})
	}
}

func requestMetaFromContext(c *gin.Context) RequestMeta {
	headers := map[string]string{}
	for _, key := range []string{
		"x-forwarded-for",
		"sec-ch-ua",
		"sec-ch-ua-platform",
		"cf-ipcountry",
		"x-vercel-ip-city",
		"x-vercel-ip-latitude",
		"x-vercel-ip-longitude",
	} {
		headers[key] = c.GetHeader(key)
	}

	return RequestMeta{
		ClientIP:  c.ClientIP(),
		UserAgent: c.GetHeader("User-Agent"),
		Origin:    c.GetHeader("Origin"),
		Referer:   c.GetHeader("Referer"),
		Headers:   headers,
	}
}

func renderHTTPError(c *gin.Context, err error, fallback string) {
	var httpErr *HTTPError
	if errors.As(err, &httpErr) && httpErr != nil {
		c.JSON(httpErr.StatusCode, gin.H{"message": httpErr.Message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"message": fallback, "error": err.Error()})
}

func optionalString(raw json.RawMessage) *string {
	if len(raw) == 0 {
		return nil
	}

	if string(raw) == "null" {
		value := ""
		return &value
	}

	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return &value
	}

	return nil
}

func hasKey(m map[string]json.RawMessage, key string) bool {
	_, ok := m[key]
	return ok
}
