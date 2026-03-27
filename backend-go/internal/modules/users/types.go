package users

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Repository interface {
	FindByID(ctx context.Context, id primitive.ObjectID) (*UserDocument, error)
	FindForWebLogin(ctx context.Context, lookup LoginLookup) (*UserDocument, error)
	FindDeletedCandidate(ctx context.Context, phone, nickname string) (*UserDocument, error)
	FindDuplicateActive(ctx context.Context, email, phone, nickname string) (*UserDocument, error)
	FindActiveByCCCD(ctx context.Context, cccd string) (*UserDocument, error)
	RestoreUser(ctx context.Context, id primitive.ObjectID) (*UserDocument, error)
	CreateUserWithRanking(ctx context.Context, params CreateUserParams) (*UserDocument, error)
	EnsureRanking(ctx context.Context, userID primitive.ObjectID) error
	UpgradePasswordHash(ctx context.Context, userID primitive.ObjectID, expectedOldPassword, nextHash string) error
	RecordLogin(ctx context.Context, event LoginEvent) error
	HasParticipated(ctx context.Context, userID primitive.ObjectID) (bool, error)
	HasStaffAssessment(ctx context.Context, userID primitive.ObjectID) (bool, error)
	LoadRanking(ctx context.Context, userID primitive.ObjectID) (*RankingDocument, error)
	ComputeRankNo(ctx context.Context, userID primitive.ObjectID) (*int, error)
}

type UserDocument struct {
	ID             primitive.ObjectID `bson:"_id" json:"_id"`
	Name           string             `bson:"name" json:"name"`
	FullName       string             `bson:"fullName" json:"fullName"`
	Nickname       string             `bson:"nickname" json:"nickname"`
	Phone          string             `bson:"phone" json:"phone"`
	Email          string             `bson:"email" json:"email"`
	Password       string             `bson:"password" json:"-"`
	Avatar         string             `bson:"avatar" json:"avatar"`
	Cover          string             `bson:"cover" json:"cover"`
	Province       string             `bson:"province" json:"province"`
	Gender         string             `bson:"gender" json:"gender"`
	Verified       string             `bson:"verified" json:"verified"`
	CCCDStatus     string             `bson:"cccdStatus" json:"cccdStatus"`
	CCCD           string             `bson:"cccd" json:"cccd"`
	Role           string             `bson:"role" json:"role"`
	IsAdmin        bool               `bson:"isAdmin" json:"isAdmin"`
	IsSuperUser    bool               `bson:"isSuperUser" json:"isSuperUser"`
	IsSuperAdmin   bool               `bson:"isSuperAdmin" json:"isSuperAdmin"`
	IsDeleted      bool               `bson:"isDeleted" json:"isDeleted"`
	DOB            *time.Time         `bson:"dob,omitempty" json:"dob,omitempty"`
	CreatedAt      time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt      time.Time          `bson:"updatedAt" json:"updatedAt"`
	RatingSingle   float64            `bson:"ratingSingle,omitempty" json:"ratingSingle,omitempty"`
	RatingDouble   float64            `bson:"ratingDouble,omitempty" json:"ratingDouble,omitempty"`
	LocalRatings   LocalRatings       `bson:"localRatings,omitempty" json:"localRatings,omitempty"`
	Evaluator      EvaluatorState     `bson:"evaluator,omitempty" json:"evaluator,omitempty"`
	CCCDImages     CCCDImages         `bson:"cccdImages,omitempty" json:"cccdImages,omitempty"`
	SignupMeta     SignupMeta         `bson:"signupMeta,omitempty" json:"signupMeta,omitempty"`
	DeletionReason string             `bson:"deletionReason,omitempty" json:"deletionReason,omitempty"`
}

type LocalRatings struct {
	Singles float64 `bson:"singles,omitempty" json:"singles,omitempty"`
	Doubles float64 `bson:"doubles,omitempty" json:"doubles,omitempty"`
}

type EvaluatorState struct {
	Enabled       bool           `bson:"enabled" json:"enabled"`
	GradingScopes EvaluatorScope `bson:"gradingScopes" json:"gradingScopes"`
}

type EvaluatorScope struct {
	Provinces []string `bson:"provinces" json:"provinces"`
	Sports    []string `bson:"sports" json:"sports"`
}

type CCCDImages struct {
	Front string `bson:"front,omitempty" json:"front,omitempty"`
	Back  string `bson:"back,omitempty" json:"back,omitempty"`
}

type SignupMeta struct {
	Platform     string       `bson:"platform,omitempty" json:"platform,omitempty"`
	AppVersion   string       `bson:"appVersion,omitempty" json:"appVersion,omitempty"`
	Device       SignupDevice `bson:"device,omitempty" json:"device,omitempty"`
	Web          SignupWeb    `bson:"web,omitempty" json:"web,omitempty"`
	IP           SignupIP     `bson:"ip,omitempty" json:"ip,omitempty"`
	Geo          SignupGeo    `bson:"geo,omitempty" json:"geo,omitempty"`
	RegisteredAt time.Time    `bson:"registeredAt,omitempty" json:"registeredAt,omitempty"`
}

type SignupDevice struct {
	Type    string `bson:"type,omitempty" json:"type,omitempty"`
	OS      string `bson:"os,omitempty" json:"os,omitempty"`
	Browser string `bson:"browser,omitempty" json:"browser,omitempty"`
	Model   string `bson:"model,omitempty" json:"model,omitempty"`
	UA      string `bson:"ua,omitempty" json:"ua,omitempty"`
}

type SignupWeb struct {
	Referer string `bson:"referer,omitempty" json:"referer,omitempty"`
	Origin  string `bson:"origin,omitempty" json:"origin,omitempty"`
}

type SignupIP struct {
	Client string   `bson:"client,omitempty" json:"client,omitempty"`
	Chain  []string `bson:"chain,omitempty" json:"chain,omitempty"`
}

type SignupGeo struct {
	Country   string `bson:"country,omitempty" json:"country,omitempty"`
	City      string `bson:"city,omitempty" json:"city,omitempty"`
	Latitude  string `bson:"latitude,omitempty" json:"latitude,omitempty"`
	Longitude string `bson:"longitude,omitempty" json:"longitude,omitempty"`
}

type RankingDocument struct {
	User               primitive.ObjectID `bson:"user" json:"user"`
	Single             float64            `bson:"single" json:"single"`
	Double             float64            `bson:"double" json:"double"`
	Mix                float64            `bson:"mix" json:"mix"`
	Points             float64            `bson:"points" json:"points"`
	UpdatedAt          *time.Time         `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
	LastUpdated        *time.Time         `bson:"lastUpdated,omitempty" json:"lastUpdated,omitempty"`
	TierLabel          string             `bson:"tierLabel" json:"tierLabel"`
	TierColor          string             `bson:"tierColor" json:"tierColor"`
	ColorRank          int                `bson:"colorRank" json:"colorRank"`
	TotalFinishedTours int                `bson:"totalFinishedTours" json:"totalFinishedTours"`
	Reputation         float64            `bson:"reputation" json:"reputation"`
}

type LoginLookup struct {
	Identifier string
	Email      string
	Phone      string
}

type CreateUserParams struct {
	Name       string
	Nickname   string
	Phone      string
	Email      string
	Password   string
	Avatar     string
	Province   string
	Gender     string
	CCCD       string
	CCCDImages CCCDImages
	SignupMeta SignupMeta
	DOB        *time.Time
}

type LoginEvent struct {
	UserID    primitive.ObjectID
	At        time.Time
	IP        string
	UserAgent string
	Method    string
	Success   bool
}

type ScorePair struct {
	Single float64 `json:"single"`
	Double float64 `json:"double"`
}

type UpdateProfileInput struct {
	Name      *string
	Nickname  *string
	Phone     *string
	DOB       *string
	Province  *string
	CCCD      *string
	Email     *string
	Password  *string
	Gender    *string
	Avatar    *string
	AvatarSet bool
	Cover     *string
	CoverSet  bool
}

type ListMyTournamentsParams struct {
	Page        int
	Limit       int
	Status      []string
	WithMatches bool
	MatchLimit  int
}
