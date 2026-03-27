package users

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"backendgo/internal/modules/systemsettings"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type fakeRepository struct {
	findForWebLoginFn       func(context.Context, LoginLookup) (*UserDocument, error)
	findDeletedCandidateFn  func(context.Context, string, string) (*UserDocument, error)
	findDuplicateActiveFn   func(context.Context, string, string, string) (*UserDocument, error)
	findActiveByCCCDFn      func(context.Context, string) (*UserDocument, error)
	createUserWithRankingFn func(context.Context, CreateUserParams) (*UserDocument, error)
	ensureRankingFn         func(context.Context, primitive.ObjectID) error
	restoreUserFn           func(context.Context, primitive.ObjectID) (*UserDocument, error)
	upgradePasswordHashFn   func(context.Context, primitive.ObjectID, string, string) error
	recordLoginFn           func(context.Context, LoginEvent) error
}

func (f fakeRepository) FindByID(context.Context, primitive.ObjectID) (*UserDocument, error) {
	return nil, nil
}

func (f fakeRepository) FindForWebLogin(ctx context.Context, lookup LoginLookup) (*UserDocument, error) {
	return f.findForWebLoginFn(ctx, lookup)
}

func (f fakeRepository) FindDeletedCandidate(ctx context.Context, phone, nickname string) (*UserDocument, error) {
	if f.findDeletedCandidateFn == nil {
		return nil, nil
	}
	return f.findDeletedCandidateFn(ctx, phone, nickname)
}

func (f fakeRepository) FindDuplicateActive(ctx context.Context, email, phone, nickname string) (*UserDocument, error) {
	if f.findDuplicateActiveFn == nil {
		return nil, nil
	}
	return f.findDuplicateActiveFn(ctx, email, phone, nickname)
}

func (f fakeRepository) FindActiveByCCCD(ctx context.Context, cccd string) (*UserDocument, error) {
	if f.findActiveByCCCDFn == nil {
		return nil, nil
	}
	return f.findActiveByCCCDFn(ctx, cccd)
}

func (f fakeRepository) RestoreUser(ctx context.Context, id primitive.ObjectID) (*UserDocument, error) {
	if f.restoreUserFn == nil {
		return nil, nil
	}
	return f.restoreUserFn(ctx, id)
}

func (f fakeRepository) CreateUserWithRanking(ctx context.Context, params CreateUserParams) (*UserDocument, error) {
	return f.createUserWithRankingFn(ctx, params)
}

func (f fakeRepository) EnsureRanking(ctx context.Context, userID primitive.ObjectID) error {
	if f.ensureRankingFn == nil {
		return nil
	}
	return f.ensureRankingFn(ctx, userID)
}

func (f fakeRepository) UpgradePasswordHash(ctx context.Context, userID primitive.ObjectID, expectedOldPassword, nextHash string) error {
	if f.upgradePasswordHashFn == nil {
		return nil
	}
	return f.upgradePasswordHashFn(ctx, userID, expectedOldPassword, nextHash)
}

func (f fakeRepository) RecordLogin(ctx context.Context, event LoginEvent) error {
	if f.recordLoginFn == nil {
		return nil
	}
	return f.recordLoginFn(ctx, event)
}

func (f fakeRepository) HasParticipated(context.Context, primitive.ObjectID) (bool, error) {
	return false, nil
}

func (f fakeRepository) HasStaffAssessment(context.Context, primitive.ObjectID) (bool, error) {
	return false, nil
}

func (f fakeRepository) LoadRanking(context.Context, primitive.ObjectID) (*RankingDocument, error) {
	return nil, nil
}

func (f fakeRepository) ComputeRankNo(context.Context, primitive.ObjectID) (*int, error) {
	return nil, nil
}

type fakeSettings struct {
	doc *systemsettings.Document
}

func (f fakeSettings) GetOrCreate(context.Context) (*systemsettings.Document, error) {
	return f.doc, nil
}

func TestLoginWebUpgradesLegacyPasswordAndSetsCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)

	userID := primitive.NewObjectID()
	var upgraded bool
	var recorded bool

	repo := fakeRepository{
		findForWebLoginFn: func(context.Context, LoginLookup) (*UserDocument, error) {
			return &UserDocument{
				ID:         userID,
				Name:       "Legacy User",
				Nickname:   "legacy",
				Phone:      "0912345678",
				Password:   "plain-password",
				Role:       "user",
				Verified:   "pending",
				CCCDStatus: "unverified",
				CreatedAt:  time.Now().UTC(),
				LocalRatings: LocalRatings{
					Singles: 2.5,
					Doubles: 2.5,
				},
			}, nil
		},
		upgradePasswordHashFn: func(_ context.Context, gotUserID primitive.ObjectID, oldPassword, nextHash string) error {
			if gotUserID != userID {
				t.Fatalf("expected user id %s, got %s", userID.Hex(), gotUserID.Hex())
			}
			if oldPassword != "plain-password" {
				t.Fatalf("expected old password to be upgraded")
			}
			if nextHash == "" || nextHash == oldPassword {
				t.Fatalf("expected bcrypt hash, got %q", nextHash)
			}
			upgraded = true
			return nil
		},
		recordLoginFn: func(_ context.Context, event LoginEvent) error {
			recorded = event.Success && event.UserID == userID
			return nil
		},
	}

	service := NewService(repo, fakeSettings{doc: &systemsettings.Document{ID: "system"}}, "test-secret", "development")
	service.now = func() time.Time { return time.Unix(1_700_000_000, 0).UTC() }

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	payload, err := service.LoginWeb(context.Background(), c, LoginInput{
		Phone:    "0912345678",
		Password: "plain-password",
		RequestMeta: RequestMeta{
			ClientIP:  "127.0.0.1",
			UserAgent: "go-test",
		},
	})
	if err != nil {
		t.Fatalf("LoginWeb returned error: %v", err)
	}

	if !upgraded {
		t.Fatalf("expected legacy password to be upgraded")
	}
	if !recorded {
		t.Fatalf("expected login to be recorded")
	}
	if payload["token"] == "" {
		t.Fatalf("expected token in payload")
	}

	cookies := recorder.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != "jwt" {
		t.Fatalf("expected jwt cookie to be set")
	}
}

func TestRegisterHonorsClosedRegistrationSetting(t *testing.T) {
	gin.SetMode(gin.TestMode)

	repo := fakeRepository{
		createUserWithRankingFn: func(context.Context, CreateUserParams) (*UserDocument, error) {
			t.Fatalf("create should not be called when registration is closed")
			return nil, nil
		},
	}

	open := false
	service := NewService(repo, fakeSettings{doc: &systemsettings.Document{
		ID: "system",
		Registration: systemsettings.RegistrationSettings{
			Open: &open,
		},
	}}, "test-secret", "development")

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	rawImages, _ := json.Marshal(map[string]string{"front": "/uploads/front.png"})
	_, _, err := service.Register(context.Background(), c, RegisterInput{
		Nickname:   "new-user",
		Password:   "123456",
		Phone:      "0912345678",
		CCCDImages: rawImages,
	})
	if err != ErrRegistrationClosed {
		t.Fatalf("expected ErrRegistrationClosed, got %v", err)
	}
}
