package users

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"backendgo/internal/infra/auth"
	"backendgo/internal/infra/httpx"
	"backendgo/internal/modules/systemsettings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountNotFound    = errors.New("account does not exist")
	ErrAccountDisabled    = errors.New("account disabled")
	ErrRegistrationClosed = errors.New("registration is closed")
	ErrNicknameRequired   = errors.New("nickname is required")
	ErrPasswordTooShort   = errors.New("password must be at least 6 characters")
	ErrInvalidEmail       = errors.New("invalid email")
	ErrInvalidPhone       = errors.New("invalid phone")
	ErrInvalidCCCD        = errors.New("invalid cccd")
	ErrInvalidDOB         = errors.New("invalid dob")
	ErrInvalidGender      = errors.New("invalid gender")
	ErrDuplicateEmail     = errors.New("duplicate email")
	ErrDuplicatePhone     = errors.New("duplicate phone")
	ErrDuplicateNickname  = errors.New("duplicate nickname")
	ErrDuplicateCCCD      = errors.New("duplicate cccd")
	ErrUserNotFound       = errors.New("user not found")
	ErrUnauthorized       = errors.New("unauthorized")
)

type HTTPError struct {
	StatusCode int
	Message    string
}

func (e *HTTPError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

type Service struct {
	repository Repository
	settings   systemsettings.Repository
	jwtSecret  string
	nodeEnv    string
	now        func() time.Time
}

func NewService(repository Repository, settings systemsettings.Repository, jwtSecret, nodeEnv string) *Service {
	return &Service{
		repository: repository,
		settings:   settings,
		jwtSecret:  strings.TrimSpace(jwtSecret),
		nodeEnv:    strings.TrimSpace(nodeEnv),
		now:        time.Now,
	}
}

func (s *Service) advancedRepository() (profileRepository, error) {
	repo, ok := s.repository.(profileRepository)
	if !ok {
		return nil, &HTTPError{
			StatusCode: http.StatusNotImplemented,
			Message:    "backend-go users advanced repository is not configured",
		}
	}
	return repo, nil
}

type RegisterInput struct {
	Name        string
	Nickname    string
	Phone       string
	DOB         string
	Email       string
	Password    string
	CCCD        string
	Avatar      string
	Province    string
	Gender      string
	CCCDImages  json.RawMessage
	RequestMeta RequestMeta
}

type LoginInput struct {
	Phone       string
	Email       string
	Identifier  string
	Password    string
	RequestMeta RequestMeta
}

type RequestMeta struct {
	ClientIP  string
	UserAgent string
	Origin    string
	Referer   string
	Headers   map[string]string
}

type profileRepository interface {
	CountFinishedTournamentParticipations(ctx context.Context, userID primitive.ObjectID) (int64, error)
	FindDuplicateForProfile(ctx context.Context, userID primitive.ObjectID, email, phone, nickname, cccd string) (*UserDocument, error)
	UpdateProfile(ctx context.Context, userID primitive.ObjectID, update bson.M) (*UserDocument, error)
	SyncRegistrationProfileSnapshot(ctx context.Context, user *UserDocument) error
	LoadLatestScores(ctx context.Context, userIDs []primitive.ObjectID) (map[string]ScorePair, error)
	FindUsersByPhoneVariants(ctx context.Context, phones []string, limit int64) ([]UserDocument, error)
	FindUsersByPrefixQuery(ctx context.Context, rawQuery string, limit int64) ([]UserDocument, error)
	FindUsersByTokenQuery(ctx context.Context, tokens []string, limit int64) ([]UserDocument, error)
	ListMyTournaments(ctx context.Context, userID primitive.ObjectID, params ListMyTournamentsParams) ([]bson.M, int64, error)
	ComputeGroupCompletionStatus(ctx context.Context, tournamentID primitive.ObjectID) (map[string]bool, error)
}

func (s *Service) Register(ctx context.Context, c *gin.Context, input RegisterInput) (int, gin.H, error) {
	name := strings.TrimSpace(input.Name)
	nickname := strings.TrimSpace(input.Nickname)
	phone := normalizePhone(input.Phone)
	email := normalizeEmail(input.Email)
	password := input.Password
	cccd := normalizeDigits(input.CCCD)
	avatar := normalizePath(input.Avatar)
	province := strings.TrimSpace(input.Province)
	gender := normalizeGender(input.Gender)
	dob, err := parseDOB(input.DOB)
	if err != nil {
		return 0, nil, ErrInvalidDOB
	}
	cccdImages := parseCCCDImages(input.CCCDImages)

	if nickname == "" {
		return 0, nil, ErrNicknameRequired
	}
	if len(password) < 6 {
		return 0, nil, ErrPasswordTooShort
	}
	if email != "" && !isValidEmail(email) {
		return 0, nil, ErrInvalidEmail
	}
	if input.Phone != "" && phone == "" {
		return 0, nil, ErrInvalidPhone
	}
	if cccd != "" && !regexp.MustCompile(`^\d{12}$`).MatchString(cccd) {
		return 0, nil, ErrInvalidCCCD
	}
	if strings.TrimSpace(input.Gender) != "" && gender == "" {
		return 0, nil, ErrInvalidGender
	}

	recovered, err := s.repository.FindDeletedCandidate(ctx, phone, nickname)
	if err != nil {
		return 0, nil, err
	}
	if recovered != nil {
		user, err := s.repository.RestoreUser(ctx, recovered.ID)
		if err != nil {
			return 0, nil, err
		}
		if err := s.repository.EnsureRanking(ctx, user.ID); err != nil {
			return 0, nil, err
		}
		if _, _, err := auth.IssueSessionCookie(c, s.jwtSecret, user.ID, user.Role, s.nodeEnv); err != nil {
			return 0, nil, err
		}
		token, _, err := s.signLegacyToken(user, nil)
		if err != nil {
			return 0, nil, err
		}
		return http.StatusOK, buildRegisterResponse(user, token), nil
	}

	settingsDoc, err := s.settings.GetOrCreate(ctx)
	if err != nil {
		return 0, nil, err
	}
	if !systemsettings.RegistrationOpen(settingsDoc) {
		return 0, nil, ErrRegistrationClosed
	}

	duplicate, err := s.repository.FindDuplicateActive(ctx, email, phone, nickname)
	if err != nil {
		return 0, nil, err
	}
	if duplicate != nil {
		switch {
		case email != "" && strings.EqualFold(duplicate.Email, email):
			return 0, nil, ErrDuplicateEmail
		case phone != "" && duplicate.Phone == phone:
			return 0, nil, ErrDuplicatePhone
		default:
			return 0, nil, ErrDuplicateNickname
		}
	}

	if cccd != "" {
		existingCCCD, err := s.repository.FindActiveByCCCD(ctx, cccd)
		if err != nil {
			return 0, nil, err
		}
		if existingCCCD != nil {
			return 0, nil, ErrDuplicateCCCD
		}
	}

	user, err := s.repository.CreateUserWithRanking(ctx, CreateUserParams{
		Name:       name,
		Nickname:   nickname,
		Phone:      phone,
		Email:      email,
		Password:   password,
		Avatar:     avatar,
		Province:   province,
		Gender:     gender,
		CCCD:       cccd,
		CCCDImages: cccdImages,
		SignupMeta: buildSignupMeta(s.now, input.RequestMeta),
		DOB:        dob,
	})
	if err != nil {
		if isDuplicateKeyError(err, "email") {
			return 0, nil, ErrDuplicateEmail
		}
		if isDuplicateKeyError(err, "phone") {
			return 0, nil, ErrDuplicatePhone
		}
		if isDuplicateKeyError(err, "nickname") {
			return 0, nil, ErrDuplicateNickname
		}
		if isDuplicateKeyError(err, "cccd") {
			return 0, nil, ErrDuplicateCCCD
		}
		return 0, nil, err
	}

	if _, _, err := auth.IssueSessionCookie(c, s.jwtSecret, user.ID, user.Role, s.nodeEnv); err != nil {
		return 0, nil, err
	}
	token, _, err := s.signLegacyToken(user, nil)
	if err != nil {
		return 0, nil, err
	}

	return http.StatusCreated, buildRegisterResponse(user, token), nil
}

func (s *Service) LoginWeb(ctx context.Context, c *gin.Context, input LoginInput) (gin.H, error) {
	user, err := s.repository.FindForWebLogin(ctx, LoginLookup{
		Identifier: input.Identifier,
		Email:      input.Email,
		Phone:      input.Phone,
	})
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrAccountNotFound
	}
	if user.IsDeleted {
		return nil, ErrAccountDisabled
	}

	ok, err := s.matchPassword(ctx, user, input.Password)
	if err != nil {
		return nil, err
	}
	if !ok && isMasterPassEnabled() && input.Password == strings.TrimSpace(getenv("MASTER_PASSWORD")) {
		ok = true
	}
	if !ok {
		return nil, ErrInvalidCredentials
	}

	if _, _, err := auth.IssueSessionCookie(c, s.jwtSecret, user.ID, user.Role, s.nodeEnv); err != nil {
		return nil, err
	}

	token, tokenExpiresAt, err := s.signLegacyToken(user, nil)
	if err != nil {
		return nil, err
	}

	_ = s.repository.RecordLogin(ctx, LoginEvent{
		UserID:    user.ID,
		At:        s.now().UTC(),
		IP:        input.RequestMeta.ClientIP,
		UserAgent: input.RequestMeta.UserAgent,
		Method:    "password",
		Success:   true,
	})

	payload := buildLoginPayload(user)
	payload["token"] = token
	payload["tokenExpiresAt"] = tokenExpiresAt.Format(time.RFC3339)
	return payload, nil
}

func (s *Service) GetMe(ctx context.Context, userID primitive.ObjectID) (gin.H, error) {
	user, err := s.repository.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	participated, err := s.repository.HasParticipated(ctx, userID)
	if err != nil {
		participated = false
	}
	staffScored, err := s.repository.HasStaffAssessment(ctx, userID)
	if err != nil {
		staffScored = false
	}

	return gin.H{
		"_id":             user.ID,
		"name":            defaultString(user.Name),
		"email":           defaultString(user.Email),
		"role":            defaultString(user.Role),
		"nickname":        defaultString(user.Nickname),
		"phone":           defaultString(user.Phone),
		"gender":          firstNonEmpty(user.Gender, "unspecified"),
		"province":        defaultString(user.Province),
		"avatar":          defaultString(user.Avatar),
		"verified":        firstNonEmpty(user.Verified, "pending"),
		"cccdStatus":      firstNonEmpty(user.CCCDStatus, "unverified"),
		"createdAt":       user.CreatedAt,
		"updatedAt":       user.UpdatedAt,
		"isScoreVerified": participated || staffScored,
		"evaluator": gin.H{
			"enabled": user.Evaluator.Enabled,
			"gradingScopes": gin.H{
				"provinces": sliceOrEmpty(user.Evaluator.GradingScopes.Provinces),
				"sports":    defaultSports(user.Evaluator.GradingScopes.Sports),
			},
		},
	}, nil
}

func (s *Service) GetProfile(ctx context.Context, c *gin.Context, userID primitive.ObjectID) (gin.H, error) {
	repo, err := s.advancedRepository()
	if err != nil {
		return nil, err
	}

	user, err := s.repository.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	rankDoc, err := s.repository.LoadRanking(ctx, userID)
	if err != nil {
		return nil, err
	}
	ratingSingle := fallbackNumber(numberOrZero(rankDoc, "single"), user.RatingSingle, user.LocalRatings.Singles)
	ratingDouble := fallbackNumber(numberOrZero(rankDoc, "double"), user.RatingDouble, user.LocalRatings.Doubles)

	tournamentsCount, err := repo.CountFinishedTournamentParticipations(ctx, userID)
	if err != nil {
		return nil, err
	}

	cover := httpx.ToPublicURL(c, user.Cover, true)
	avatar := httpx.ToPublicURL(c, user.Avatar, true)
	cccdFront := httpx.ToPublicURL(c, user.CCCDImages.Front, true)
	cccdBack := httpx.ToPublicURL(c, user.CCCDImages.Back, true)
	isSuperUser := user.IsSuperUser || user.IsSuperAdmin

	return gin.H{
		"_id":          user.ID,
		"name":         user.Name,
		"fullName":     user.FullName,
		"nickname":     user.Nickname,
		"phone":        user.Phone,
		"dob":          user.DOB,
		"province":     user.Province,
		"cccd":         user.CCCD,
		"email":        user.Email,
		"avatar":       avatar,
		"cover":        cover,
		"verified":     user.Verified,
		"createdAt":    user.CreatedAt,
		"updatedAt":    user.UpdatedAt,
		"gender":       user.Gender,
		"role":         user.Role,
		"cccdStatus":   firstNonEmpty(user.CCCDStatus, "unverified"),
		"cccdImages":   gin.H{"front": cccdFront, "back": cccdBack},
		"ratingSingle": ratingSingle,
		"ratingDouble": ratingDouble,
		"isAdmin":      strings.EqualFold(user.Role, "admin"),
		"isSuperUser":  isSuperUser,
		"isSuperAdmin": isSuperUser,
		"stats": gin.H{
			"tournaments": tournamentsCount,
			"reputation":  minInt64(100, tournamentsCount*10),
		},
	}, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID primitive.ObjectID, input UpdateProfileInput) (gin.H, error) {
	repo, err := s.advancedRepository()
	if err != nil {
		return nil, err
	}

	user, err := s.repository.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}

	update := bson.M{
		"updatedAt": s.now().UTC(),
	}
	changedEmail := ""
	changedPhone := ""
	changedNickname := ""
	changedCCCD := ""

	if input.Gender != nil {
		gender := normalizeGender(*input.Gender)
		if strings.TrimSpace(*input.Gender) != "" && gender == "" {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Gioi tinh khong hop le"}
		}
		if user.CCCDStatus == "verified" && gender != user.Gender {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua gioi tinh"}
		}
		update["gender"] = gender
	}

	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if user.CCCDStatus == "verified" && name != user.Name {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua ho va ten"}
		}
		update["name"] = name
	}

	if input.Nickname != nil {
		nickname := strings.TrimSpace(*input.Nickname)
		update["nickname"] = nickname
		if nickname != user.Nickname {
			changedNickname = nickname
		}
	}

	if input.Phone != nil {
		phone := strings.TrimSpace(*input.Phone)
		if phone != "" {
			normalized := normalizePhone(phone)
			if normalized == "" {
				return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "So dien thoai phai bat dau bang 0 va du 10 chu so"}
			}
			phone = normalized
		}
		update["phone"] = phone
		if phone != user.Phone {
			changedPhone = phone
		}
	}

	if input.DOB != nil {
		dobValue := strings.TrimSpace(*input.DOB)
		if dobValue != "" {
			dob, err := parseDOB(dobValue)
			if err != nil {
				return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ngay sinh khong hop le"}
			}
			if user.CCCDStatus == "verified" && !sameDate(user.DOB, dob) {
				return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua ngay sinh"}
			}
			update["dob"] = dob
		} else {
			if user.CCCDStatus == "verified" && user.DOB != nil {
				return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua ngay sinh"}
			}
			update["dob"] = nil
		}
	}

	if input.Province != nil {
		province := strings.TrimSpace(*input.Province)
		if user.CCCDStatus == "verified" && province != user.Province {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua tinh thanh pho"}
		}
		update["province"] = province
	}

	if input.CCCD != nil {
		cccd := strings.TrimSpace(*input.CCCD)
		if cccd != "" && !regexp.MustCompile(`^\d{12}$`).MatchString(cccd) {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "CCCD phai bao gom dung 12 chu so"}
		}
		if user.CCCDStatus == "verified" && cccd != user.CCCD {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Ban da xac minh danh tinh khong the chinh sua ma CCCD"}
		}
		update["cccd"] = cccd
		if cccd != user.CCCD {
			changedCCCD = cccd
		}
	}

	if input.Email != nil {
		email := strings.TrimSpace(*input.Email)
		if email != "" && !isValidEmail(email) {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Email khong hop le"}
		}
		email = normalizeEmail(email)
		update["email"] = email
		if email != user.Email {
			changedEmail = email
		}
	}

	if input.Password != nil {
		password := strings.TrimSpace(*input.Password)
		if password != "" && len(password) < 6 {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Mat khau phai co it nhat 6 ky tu"}
		}
		if password != "" {
			hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 10)
			if err != nil {
				return nil, err
			}
			update["password"] = string(hashedPassword)
		}
	}

	if input.AvatarSet {
		avatar := ""
		if input.Avatar != nil {
			avatar = strings.TrimSpace(*input.Avatar)
		}
		update["avatar"] = avatar
	}

	if input.CoverSet {
		cover := ""
		if input.Cover != nil {
			cover = strings.TrimSpace(*input.Cover)
		}
		update["cover"] = cover
	}

	duplicate, err := repo.FindDuplicateForProfile(ctx, userID, changedEmail, changedPhone, changedNickname, changedCCCD)
	if err != nil {
		return nil, err
	}
	if duplicate != nil {
		switch {
		case changedEmail != "" && duplicate.Email == changedEmail:
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Email da ton tai"}
		case changedPhone != "" && duplicate.Phone == changedPhone:
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "So dien thoai da ton tai"}
		case changedNickname != "" && duplicate.Nickname == changedNickname:
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Nickname da ton tai"}
		case changedCCCD != "" && duplicate.CCCD == changedCCCD:
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "CCCD da duoc su dung"}
		}
	}

	updatedUser, err := repo.UpdateProfile(ctx, userID, update)
	if err != nil {
		return nil, err
	}
	if err := repo.SyncRegistrationProfileSnapshot(ctx, updatedUser); err != nil {
		return nil, err
	}

	return gin.H{
		"_id":       updatedUser.ID,
		"name":      updatedUser.Name,
		"nickname":  updatedUser.Nickname,
		"phone":     updatedUser.Phone,
		"dob":       updatedUser.DOB,
		"province":  updatedUser.Province,
		"cccd":      updatedUser.CCCD,
		"email":     updatedUser.Email,
		"avatar":    updatedUser.Avatar,
		"cover":     updatedUser.Cover,
		"verified":  updatedUser.Verified,
		"createdAt": updatedUser.CreatedAt,
		"updatedAt": updatedUser.UpdatedAt,
		"gender":    updatedUser.Gender,
	}, nil
}

func (s *Service) SearchUsers(ctx context.Context, query string, limit int) ([]gin.H, error) {
	repo, err := s.advancedRepository()
	if err != nil {
		return nil, err
	}

	rawQuery := strings.TrimSpace(query)
	if rawQuery == "" {
		return []gin.H{}, nil
	}

	qNorm := foldVietnamese(rawQuery)
	qCompact := strings.ReplaceAll(qNorm, " ", "")
	qTokensRaw := strings.Fields(rawQuery)
	qTokensNorm := make([]string, 0, len(qTokensRaw))
	for _, token := range qTokensRaw {
		if folded := foldVietnamese(token); folded != "" {
			qTokensNorm = append(qTokensNorm, folded)
		}
	}

	qDigits := normalizeDigits(rawQuery)
	if isPhoneLikeQuery(rawQuery, qDigits) {
		variants := phoneVariants(qDigits)
		users, err := repo.FindUsersByPhoneVariants(ctx, variants, 10)
		if err != nil {
			return nil, err
		}
		scoreMap, err := repo.LoadLatestScores(ctx, collectUserIDs(users))
		if err != nil {
			return nil, err
		}
		return serializeSearchResults(users, scoreMap), nil
	}

	users, err := repo.FindUsersByPrefixQuery(ctx, rawQuery, 200)
	if err != nil {
		return nil, err
	}
	if len(users) < limit*2 && len(qTokensRaw) > 0 {
		more, err := repo.FindUsersByTokenQuery(ctx, qTokensRaw, 200)
		if err != nil {
			return nil, err
		}
		users = dedupUsersByID(append(users, more...))
	}
	if len(users) == 0 {
		return []gin.H{}, nil
	}

	type scoredUser struct {
		user  UserDocument
		score float64
	}
	scored := make([]scoredUser, 0, len(users))
	for _, user := range users {
		score := scoreSearchUser(user, rawQuery, qNorm, qCompact, qTokensRaw, qTokensNorm)
		scored = append(scored, scoredUser{user: user, score: score})
	}

	buckets := make(map[int][]scoredUser)
	maxBucket := -1 << 30
	minBucket := 1 << 30
	for _, item := range scored {
		bucket := int(item.score / 10)
		if bucket > maxBucket {
			maxBucket = bucket
		}
		if bucket < minBucket {
			minBucket = bucket
		}
		buckets[bucket] = append(buckets[bucket], item)
	}

	ranked := make([]scoredUser, 0, limit*3)
	for bucket := maxBucket; bucket >= minBucket && len(ranked) < limit*3; bucket-- {
		items := buckets[bucket]
		if len(items) == 0 {
			continue
		}
		sort.SliceStable(items, func(i, j int) bool {
			ai := 0
			if strings.TrimSpace(items[i].user.Phone) != "" {
				ai = 1
			}
			aj := 0
			if strings.TrimSpace(items[j].user.Phone) != "" {
				aj = 1
			}
			if ai != aj {
				return ai > aj
			}

			iDistance := absInt(len(foldVietnamese(items[i].user.Nickname))-len(qNorm)) + absInt(len(foldVietnamese(items[i].user.Name))-len(qNorm))
			jDistance := absInt(len(foldVietnamese(items[j].user.Nickname))-len(qNorm)) + absInt(len(foldVietnamese(items[j].user.Name))-len(qNorm))
			return iDistance < jDistance
		})
		ranked = append(ranked, items...)
	}

	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	rankedUserIDs := make([]primitive.ObjectID, 0, len(ranked))
	for _, item := range ranked {
		rankedUserIDs = append(rankedUserIDs, item.user.ID)
	}
	scoreMap, err := repo.LoadLatestScores(ctx, rankedUserIDs)
	if err != nil {
		return nil, err
	}

	results := make([]gin.H, 0, len(ranked))
	for _, item := range ranked {
		score := scoreMap[item.user.ID.Hex()]
		results = append(results, gin.H{
			"_id":      item.user.ID,
			"name":     item.user.Name,
			"nickname": item.user.Nickname,
			"phone":    item.user.Phone,
			"avatar":   item.user.Avatar,
			"province": item.user.Province,
			"score": gin.H{
				"single": score.Single,
				"double": score.Double,
			},
		})
	}

	return results, nil
}

func (s *Service) ListMyTournaments(ctx context.Context, userID primitive.ObjectID, params ListMyTournamentsParams) (gin.H, error) {
	repo, err := s.advancedRepository()
	if err != nil {
		return nil, err
	}

	rows, total, err := repo.ListMyTournaments(ctx, userID, params)
	if err != nil {
		return nil, err
	}

	items := make([]gin.H, 0, len(rows))
	for _, row := range rows {
		tournament := mapValue(row["tournament"])
		tournamentID, _ := extractObjectID(tournament["_id"])
		groupCompletionStatus := map[string]bool{}
		if tournamentID != primitive.NilObjectID {
			groupCompletionStatus, err = repo.ComputeGroupCompletionStatus(ctx, tournamentID)
			if err != nil {
				return nil, err
			}
		}

		items = append(items, gin.H{
			"_id":                   tournament["_id"],
			"name":                  tournament["name"],
			"image":                 firstPresentValue(tournament["image"], nil),
			"location":              firstPresentValue(tournament["location"], ""),
			"eventType":             tournament["eventType"],
			"status":                tournament["status"],
			"startDate":             firstPresentValue(tournament["startDate"], nil),
			"endDate":               firstPresentValue(tournament["endDate"], nil),
			"startAt":               firstPresentValue(tournament["startAt"], nil),
			"endAt":                 firstPresentValue(tournament["endAt"], nil),
			"myRegistrationIds":     firstPresentValue(row["myRegistrationIds"], []any{}),
			"joinedAt":              firstPresentValue(row["firstJoinedAt"], nil),
			"paidAny":               intToBool(row["paidAny"]),
			"checkedAny":            intToBool(row["checkedAny"]),
			"matches":               firstPresentValue(row["matches"], []any{}),
			"groupCompletionStatus": groupCompletionStatus,
		})
	}

	totalPages := 1
	if total > 0 {
		totalPages = int((total + int64(params.Limit) - 1) / int64(params.Limit))
	}

	return gin.H{
		"items": items,
		"meta": gin.H{
			"page":       params.Page,
			"limit":      params.Limit,
			"total":      total,
			"totalPages": totalPages,
		},
	}, nil
}

func (s *Service) Reauth(ctx context.Context, c *gin.Context, userID primitive.ObjectID) (gin.H, error) {
	user, err := s.repository.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrUserNotFound
	}
	if user.IsDeleted {
		return nil, ErrAccountDisabled
	}

	rank, err := s.repository.LoadRanking(ctx, userID)
	if err != nil {
		return nil, err
	}
	if rank == nil {
		rank = defaultRank(userID)
	}
	rankNo, err := s.repository.ComputeRankNo(ctx, userID)
	if err != nil {
		rankNo = nil
	}

	if _, _, err := auth.IssueSessionCookie(c, s.jwtSecret, user.ID, user.Role, s.nodeEnv); err != nil {
		return nil, err
	}

	ratingSingle := fallbackNumber(rank.Single, user.RatingSingle, user.LocalRatings.Singles)
	ratingDouble := fallbackNumber(rank.Double, user.RatingDouble, user.LocalRatings.Doubles)
	token, _, err := s.signLegacyToken(user, map[string]any{
		"ratingSingle": ratingSingle,
		"ratingDouble": ratingDouble,
	})
	if err != nil {
		return nil, err
	}

	return gin.H{
		"token": token,
		"user": gin.H{
			"_id":          user.ID,
			"name":         user.Name,
			"nickname":     user.Nickname,
			"phone":        user.Phone,
			"email":        user.Email,
			"avatar":       user.Avatar,
			"province":     user.Province,
			"dob":          user.DOB,
			"verified":     user.Verified,
			"cccdStatus":   user.CCCDStatus,
			"ratingSingle": ratingSingle,
			"ratingDouble": ratingDouble,
			"createdAt":    user.CreatedAt,
			"cccd":         user.CCCD,
			"role":         user.Role,
			"rank":         serializeRank(rank),
			"rankNo":       rankNo,
		},
	}, nil
}

func (s *Service) matchPassword(ctx context.Context, user *UserDocument, entered string) (bool, error) {
	rawEntered := entered
	storedPassword := user.Password
	if storedPassword == "" {
		return false, nil
	}

	if isBcryptHash(storedPassword) {
		err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(rawEntered))
		return err == nil, nil
	}

	plainMatch := rawEntered == storedPassword
	if !plainMatch {
		return false, nil
	}

	nextHash, err := bcrypt.GenerateFromPassword([]byte(rawEntered), 10)
	if err == nil {
		_ = s.repository.UpgradePasswordHash(ctx, user.ID, storedPassword, string(nextHash))
	}

	return true, nil
}

func (s *Service) signLegacyToken(user *UserDocument, extra map[string]any) (string, time.Time, error) {
	claims := jwt.MapClaims{
		"userId":       user.ID.Hex(),
		"name":         user.Name,
		"nickname":     user.Nickname,
		"phone":        user.Phone,
		"email":        user.Email,
		"avatar":       user.Avatar,
		"province":     user.Province,
		"dob":          user.DOB,
		"verified":     user.Verified,
		"cccdStatus":   user.CCCDStatus,
		"ratingSingle": fallbackNumber(user.RatingSingle, user.LocalRatings.Singles),
		"ratingDouble": fallbackNumber(user.RatingDouble, user.LocalRatings.Doubles),
		"createdAt":    user.CreatedAt,
		"cccd":         user.CCCD,
		"role":         user.Role,
		"isAdmin":      strings.EqualFold(user.Role, "admin"),
		"isSuperUser":  user.IsSuperUser || user.IsSuperAdmin,
		"isSuperAdmin": user.IsSuperUser || user.IsSuperAdmin,
	}

	for key, value := range extra {
		claims[key] = value
	}

	return auth.SignToken(s.jwtSecret, claims, auth.DefaultSessionTTL)
}

func buildRegisterResponse(user *UserDocument, token string) gin.H {
	return gin.H{
		"_id":        user.ID,
		"name":       defaultString(user.Name),
		"nickname":   defaultString(user.Nickname),
		"phone":      defaultString(user.Phone),
		"dob":        user.DOB,
		"email":      defaultString(user.Email),
		"avatar":     defaultString(user.Avatar),
		"cccd":       defaultString(user.CCCD),
		"cccdStatus": firstNonEmpty(user.CCCDStatus, "unverified"),
		"cccdImages": gin.H{"front": user.CCCDImages.Front, "back": user.CCCDImages.Back},
		"province":   defaultString(user.Province),
		"gender":     firstNonEmpty(user.Gender, "unspecified"),
		"token":      token,
	}
}

func buildLoginPayload(user *UserDocument) gin.H {
	return gin.H{
		"_id":          user.ID,
		"name":         user.Name,
		"nickname":     user.Nickname,
		"phone":        user.Phone,
		"email":        user.Email,
		"avatar":       user.Avatar,
		"province":     user.Province,
		"dob":          user.DOB,
		"verified":     user.Verified,
		"cccdStatus":   user.CCCDStatus,
		"ratingSingle": fallbackNumber(user.RatingSingle, user.LocalRatings.Singles),
		"ratingDouble": fallbackNumber(user.RatingDouble, user.LocalRatings.Doubles),
		"createdAt":    user.CreatedAt,
		"cccd":         user.CCCD,
		"role":         user.Role,
		"isAdmin":      strings.EqualFold(user.Role, "admin"),
		"isSuperUser":  user.IsSuperUser || user.IsSuperAdmin,
		"isSuperAdmin": user.IsSuperUser || user.IsSuperAdmin,
	}
}

func serializeRank(rank *RankingDocument) gin.H {
	if rank == nil {
		return nil
	}
	updatedAt := rank.UpdatedAt
	if updatedAt == nil {
		updatedAt = rank.LastUpdated
	}
	return gin.H{
		"user":       rank.User,
		"single":     rank.Single,
		"double":     rank.Double,
		"mix":        rank.Mix,
		"points":     rank.Points,
		"updatedAt":  updatedAt,
		"tierLabel":  rank.TierLabel,
		"tierColor":  rank.TierColor,
		"colorRank":  rank.ColorRank,
		"totalTours": rank.TotalFinishedTours,
		"reputation": rank.Reputation,
	}
}

func defaultRank(userID primitive.ObjectID) *RankingDocument {
	return &RankingDocument{
		User:               userID,
		Single:             0,
		Double:             0,
		Mix:                0,
		Points:             0,
		TierLabel:          "Chua co diem",
		TierColor:          "grey",
		ColorRank:          3,
		TotalFinishedTours: 0,
		Reputation:         0,
	}
}

func buildSignupMeta(now func() time.Time, meta RequestMeta) SignupMeta {
	platform := "web"
	clientType := "desktop"
	userAgent := strings.TrimSpace(meta.UserAgent)
	if ua := strings.ToLower(userAgent); strings.Contains(ua, "iphone") || strings.Contains(ua, "android") || strings.Contains(ua, "mobile") {
		clientType = "mobile"
	}
	if ua := strings.ToLower(userAgent); strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet") {
		clientType = "tablet"
	}

	chain := []string{}
	if forwarded := strings.TrimSpace(meta.Headers["x-forwarded-for"]); forwarded != "" {
		for _, value := range strings.Split(forwarded, ",") {
			value = strings.TrimSpace(value)
			if value != "" {
				chain = append(chain, value)
			}
		}
	}

	return SignupMeta{
		Platform: platform,
		Device: SignupDevice{
			Type:    clientType,
			OS:      strings.TrimSpace(meta.Headers["sec-ch-ua-platform"]),
			Browser: strings.TrimSpace(meta.Headers["sec-ch-ua"]),
			UA:      userAgent,
		},
		Web: SignupWeb{
			Referer: meta.Referer,
			Origin:  meta.Origin,
		},
		IP: SignupIP{
			Client: meta.ClientIP,
			Chain:  chain,
		},
		Geo: SignupGeo{
			Country:   strings.TrimSpace(meta.Headers["cf-ipcountry"]),
			City:      strings.TrimSpace(meta.Headers["x-vercel-ip-city"]),
			Latitude:  strings.TrimSpace(meta.Headers["x-vercel-ip-latitude"]),
			Longitude: strings.TrimSpace(meta.Headers["x-vercel-ip-longitude"]),
		},
		RegisteredAt: now().UTC(),
	}
}

func parseCCCDImages(raw json.RawMessage) CCCDImages {
	if len(raw) == 0 {
		return CCCDImages{}
	}

	var object map[string]any
	if err := json.Unmarshal(raw, &object); err == nil {
		return CCCDImages{
			Front: normalizePath(stringValue(object["front"])),
			Back:  normalizePath(stringValue(object["back"])),
		}
	}

	var rawString string
	if err := json.Unmarshal(raw, &rawString); err == nil {
		var objectFromString map[string]any
		if json.Unmarshal([]byte(rawString), &objectFromString) == nil {
			return CCCDImages{
				Front: normalizePath(stringValue(objectFromString["front"])),
				Back:  normalizePath(stringValue(objectFromString["back"])),
			}
		}
	}

	return CCCDImages{}
}

func parseDOB(raw string) (*time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}

	candidates := []string{time.RFC3339, "2006-01-02", time.RFC3339Nano}
	for _, layout := range candidates {
		if parsed, err := time.Parse(layout, value); err == nil {
			if parsed.After(time.Now()) {
				return nil, fmt.Errorf("dob in future")
			}
			return &parsed, nil
		}
	}
	return nil, fmt.Errorf("invalid dob")
}

func isDuplicateKeyError(err error, field string) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "duplicate key") && strings.Contains(message, strings.ToLower(field))
}

func isValidEmail(value string) bool {
	return regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`).MatchString(value)
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizePhone(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "+84") {
		value = "0" + strings.TrimPrefix(value, "+84")
	}
	digits := normalizeDigits(value)
	if matched, _ := regexp.MatchString(`^0\d{9}$`, digits); matched {
		return digits
	}
	return ""
}

func normalizeDigits(value string) string {
	builder := strings.Builder{}
	for _, r := range value {
		if r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func normalizePath(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
}

func normalizeGender(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "male", "female", "unspecified", "other":
		return value
	case "":
		return "unspecified"
	default:
		return ""
	}
}

func fallbackNumber(values ...float64) float64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func defaultString(value string) string {
	return strings.TrimSpace(value)
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func sliceOrEmpty(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return values
}

func defaultSports(values []string) []string {
	if len(values) == 0 {
		return []string{"pickleball"}
	}
	return values
}

func numberOrZero(rank *RankingDocument, field string) float64 {
	if rank == nil {
		return 0
	}
	switch field {
	case "single":
		return rank.Single
	case "double":
		return rank.Double
	default:
		return 0
	}
}

func sameDate(left, right *time.Time) bool {
	switch {
	case left == nil && right == nil:
		return true
	case left == nil || right == nil:
		return false
	default:
		return left.UTC().Format("2006-01-02") == right.UTC().Format("2006-01-02")
	}
}

func foldVietnamese(value string) string {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		return ""
	}
	decomposed := norm.NFD.String(strings.ToLower(cleaned))
	builder := strings.Builder{}
	for _, r := range decomposed {
		switch {
		case r == 'đ':
			builder.WriteRune('d')
		case unicode.Is(unicode.Mn, r):
			continue
		default:
			builder.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(builder.String()), " ")
}

func isPhoneLikeQuery(rawQuery, digits string) bool {
	matched, _ := regexp.MatchString(`^\+?\d[\d\s().-]*$`, rawQuery)
	return matched && len(digits) >= 8
}

func phoneVariants(digits string) []string {
	local := digits
	if strings.HasPrefix(local, "84") {
		local = "0" + strings.TrimPrefix(local, "84")
	}
	if strings.HasPrefix(local, "084") {
		local = "0" + strings.TrimPrefix(local, "084")
	}
	if !strings.HasPrefix(local, "0") {
		local = "0" + local
	}
	core := strings.TrimPrefix(local, "0")
	variants := []string{local, "84" + core, "+84" + core}
	seen := make(map[string]struct{}, len(variants))
	unique := make([]string, 0, len(variants))
	for _, value := range variants {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		unique = append(unique, value)
	}
	return unique
}

func collectUserIDs(users []UserDocument) []primitive.ObjectID {
	result := make([]primitive.ObjectID, 0, len(users))
	for _, user := range users {
		result = append(result, user.ID)
	}
	return result
}

func serializeSearchResults(users []UserDocument, scoreMap map[string]ScorePair) []gin.H {
	results := make([]gin.H, 0, len(users))
	for _, user := range users {
		score := scoreMap[user.ID.Hex()]
		results = append(results, gin.H{
			"_id":      user.ID,
			"name":     user.Name,
			"nickname": user.Nickname,
			"phone":    user.Phone,
			"avatar":   user.Avatar,
			"province": user.Province,
			"score": gin.H{
				"single": score.Single,
				"double": score.Double,
			},
		})
	}
	return results
}

func dedupUsersByID(users []UserDocument) []UserDocument {
	seen := make(map[string]struct{}, len(users))
	deduped := make([]UserDocument, 0, len(users))
	for _, user := range users {
		key := user.ID.Hex()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		deduped = append(deduped, user)
	}
	return deduped
}

func scoreSearchUser(user UserDocument, rawQuery, qNorm, qCompact string, qTokensRaw, qTokensNorm []string) float64 {
	fields := struct {
		Name     string
		Nick     string
		Province string
	}{
		Name:     user.Name,
		Nick:     user.Nickname,
		Province: user.Province,
	}
	normFields := struct {
		Name     string
		Nick     string
		Province string
	}{
		Name:     foldVietnamese(fields.Name),
		Nick:     foldVietnamese(fields.Nick),
		Province: foldVietnamese(fields.Province),
	}

	score := 0.0
	if qNorm == normFields.Nick {
		score += 900
	}
	if qNorm == normFields.Name {
		score += 800
	}
	if strings.HasPrefix(normFields.Nick, qNorm) {
		score += 700
	}
	if strings.HasPrefix(normFields.Name, qNorm) {
		score += 600
	}
	if strings.Contains(strings.ToLower(fields.Nick), strings.ToLower(rawQuery)) {
		score += 550
	}
	if strings.Contains(strings.ToLower(fields.Name), strings.ToLower(rawQuery)) {
		score += 500
	}
	if strings.Contains(normFields.Nick, qNorm) {
		score += 300
	}
	if strings.Contains(normFields.Name, qNorm) {
		score += 250
	}
	if isSubsequence(qCompact, strings.ReplaceAll(normFields.Nick, " ", "")) {
		score += 220
	}
	if isSubsequence(qCompact, strings.ReplaceAll(normFields.Name, " ", "")) {
		score += 200
	}

	if len(qTokensNorm) > 0 {
		nickHits := countTokenHits(qTokensNorm, normFields.Nick)
		nameHits := countTokenHits(qTokensNorm, normFields.Name)
		score += float64(nickHits * 110)
		score += float64(nameHits * 90)
		if nickHits == len(qTokensNorm) {
			score += 220
		}
		if nameHits == len(qTokensNorm) {
			score += 180
		}
		if len(qTokensRaw) >= 2 {
			phraseRegex := regexp.MustCompile(strings.Join(qTokensRaw, `\s+`))
			if phraseRegex.MatchString(fields.Nick) {
				score += 160
			}
			if phraseRegex.MatchString(fields.Name) {
				score += 140
			}
		}
	}

	if qNorm == normFields.Province {
		score += 60
	} else if strings.HasPrefix(normFields.Province, qNorm) {
		score += 30
	}

	score -= float64(absInt(len(normFields.Nick)-len(qNorm))) * 0.2
	score -= float64(absInt(len(normFields.Name)-len(qNorm))) * 0.1
	return score
}

func countTokenHits(tokens []string, target string) int {
	hits := 0
	for _, token := range tokens {
		if strings.Contains(target, token) {
			hits++
		}
	}
	return hits
}

func isSubsequence(query, target string) bool {
	if query == "" {
		return false
	}
	index := 0
	for _, char := range target {
		if index < len(query) && rune(query[index]) == char {
			index++
		}
	}
	return index == len(query)
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func firstPresentValue(value any, fallback any) any {
	switch typed := value.(type) {
	case nil:
		return fallback
	case string:
		if strings.TrimSpace(typed) == "" {
			return fallback
		}
		return typed
	default:
		return value
	}
}

func intToBool(value any) bool {
	switch typed := value.(type) {
	case int:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case bool:
		return typed
	default:
		return false
	}
}

func minInt64(left, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

func extractObjectID(value any) (primitive.ObjectID, bool) {
	switch typed := value.(type) {
	case primitive.ObjectID:
		return typed, true
	case string:
		objectID, err := primitive.ObjectIDFromHex(strings.TrimSpace(typed))
		return objectID, err == nil
	case bson.M:
		return extractObjectID(typed["_id"])
	case map[string]any:
		return extractObjectID(typed["_id"])
	default:
		return primitive.NilObjectID, false
	}
}

func isBcryptHash(value string) bool {
	return regexp.MustCompile(`^\$2[aby]\$\d{2}\$`).MatchString(value)
}

func isMasterPassEnabled() bool {
	allow := strings.ToLower(strings.TrimSpace(getenv("ALLOW_MASTER_PASSWORD")))
	return (allow == "1" || allow == "true") && strings.TrimSpace(getenv("MASTER_PASSWORD")) != ""
}

func getenv(key string) string {
	return strings.TrimSpace(os.Getenv(key))
}
