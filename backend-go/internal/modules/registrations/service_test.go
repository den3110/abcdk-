package registrations

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"backendgo/internal/infra/auth"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

type fakeRepository struct {
	findTournamentFn              func(context.Context, primitive.ObjectID) (*TournamentDocument, error)
	isTournamentManagerFn         func(context.Context, primitive.ObjectID, primitive.ObjectID) (bool, error)
	listRegistrationsFn           func(context.Context, primitive.ObjectID) ([]RegistrationDocument, error)
	assignMissingCodesFn          func(context.Context, []RegistrationDocument) error
	loadUsersByIDsFn              func(context.Context, []primitive.ObjectID) ([]UserDocument, error)
	setCheckinFn                  func(context.Context, primitive.ObjectID) (*RegistrationDocument, error)
	findRegistrationByIDFn        func(context.Context, primitive.ObjectID) (*RegistrationDocument, error)
	countMatchUsageFn             func(context.Context, primitive.ObjectID) (int64, error)
	deleteRegistrationFn          func(context.Context, primitive.ObjectID) error
	decrementTournamentFn         func(context.Context, primitive.ObjectID) error
	countRegistrationsByTourFn    func(context.Context, primitive.ObjectID) (int64, error)
	findDuplicateRegistrationFn   func(context.Context, primitive.ObjectID, []primitive.ObjectID) (*RegistrationDocument, error)
	loadLatestScoresFn            func(context.Context, []primitive.ObjectID) (map[string]ScorePair, error)
	createRegistrationFn          func(context.Context, *RegistrationDocument) (*RegistrationDocument, error)
	incrementTournamentRegistered func(context.Context, primitive.ObjectID) error
}

func (f fakeRepository) FindTournament(ctx context.Context, tournamentID primitive.ObjectID) (*TournamentDocument, error) {
	if f.findTournamentFn == nil {
		return nil, nil
	}
	return f.findTournamentFn(ctx, tournamentID)
}

func (f fakeRepository) IsTournamentManager(ctx context.Context, tournamentID, userID primitive.ObjectID) (bool, error) {
	if f.isTournamentManagerFn == nil {
		return false, nil
	}
	return f.isTournamentManagerFn(ctx, tournamentID, userID)
}

func (f fakeRepository) ListRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) ([]RegistrationDocument, error) {
	if f.listRegistrationsFn == nil {
		return []RegistrationDocument{}, nil
	}
	return f.listRegistrationsFn(ctx, tournamentID)
}

func (f fakeRepository) AssignMissingCodes(ctx context.Context, registrations []RegistrationDocument) error {
	if f.assignMissingCodesFn == nil {
		return nil
	}
	return f.assignMissingCodesFn(ctx, registrations)
}

func (f fakeRepository) LoadUsersByIDs(ctx context.Context, userIDs []primitive.ObjectID) ([]UserDocument, error) {
	if f.loadUsersByIDsFn == nil {
		return []UserDocument{}, nil
	}
	return f.loadUsersByIDsFn(ctx, userIDs)
}

func (f fakeRepository) SetCheckin(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error) {
	if f.setCheckinFn == nil {
		return nil, errors.New("unexpected call")
	}
	return f.setCheckinFn(ctx, registrationID)
}

func (f fakeRepository) FindRegistrationByID(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error) {
	if f.findRegistrationByIDFn == nil {
		return nil, nil
	}
	return f.findRegistrationByIDFn(ctx, registrationID)
}

func (f fakeRepository) CountMatchUsage(ctx context.Context, registrationID primitive.ObjectID) (int64, error) {
	if f.countMatchUsageFn == nil {
		return 0, nil
	}
	return f.countMatchUsageFn(ctx, registrationID)
}

func (f fakeRepository) DeleteRegistration(ctx context.Context, registrationID primitive.ObjectID) error {
	if f.deleteRegistrationFn == nil {
		return nil
	}
	return f.deleteRegistrationFn(ctx, registrationID)
}

func (f fakeRepository) DecrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error {
	if f.decrementTournamentFn == nil {
		return nil
	}
	return f.decrementTournamentFn(ctx, tournamentID)
}

func (f fakeRepository) CountRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) (int64, error) {
	if f.countRegistrationsByTourFn == nil {
		return 0, nil
	}
	return f.countRegistrationsByTourFn(ctx, tournamentID)
}

func (f fakeRepository) FindDuplicateRegistration(ctx context.Context, tournamentID primitive.ObjectID, userIDs []primitive.ObjectID) (*RegistrationDocument, error) {
	if f.findDuplicateRegistrationFn == nil {
		return nil, nil
	}
	return f.findDuplicateRegistrationFn(ctx, tournamentID, userIDs)
}

func (f fakeRepository) LoadLatestScores(ctx context.Context, userIDs []primitive.ObjectID) (map[string]ScorePair, error) {
	if f.loadLatestScoresFn == nil {
		return map[string]ScorePair{}, nil
	}
	return f.loadLatestScoresFn(ctx, userIDs)
}

func (f fakeRepository) CreateRegistration(ctx context.Context, registration *RegistrationDocument) (*RegistrationDocument, error) {
	if f.createRegistrationFn == nil {
		return registration, nil
	}
	return f.createRegistrationFn(ctx, registration)
}

func (f fakeRepository) IncrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error {
	if f.incrementTournamentRegistered == nil {
		return nil
	}
	return f.incrementTournamentRegistered(ctx, tournamentID)
}

func TestCreateRegistrationRejectsClosedWindow(t *testing.T) {
	service := NewService(fakeRepository{
		findTournamentFn: func(context.Context, primitive.ObjectID) (*TournamentDocument, error) {
			return &TournamentDocument{
				ID:                   primitive.NewObjectID(),
				EventType:            "double",
				RegOpenDate:          time.Now().UTC().Add(2 * time.Hour),
				RegistrationDeadline: time.Now().UTC().Add(24 * time.Hour),
			}, nil
		},
	})

	_, err := service.CreateRegistration(context.Background(), primitive.NewObjectID().Hex(), &auth.User{ID: primitive.NewObjectID()}, CreateRegistrationInput{
		Player1ID: primitive.NewObjectID().Hex(),
		Player2ID: primitive.NewObjectID().Hex(),
	})
	if err == nil {
		t.Fatalf("expected error")
	}

	var httpErr *HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 400 {
		t.Fatalf("expected HTTP 400 error, got %v", err)
	}
}

func TestCreateRegistrationBuildsPaidRegistrationForFreeTournament(t *testing.T) {
	tournamentID := primitive.NewObjectID()
	player1ID := primitive.NewObjectID()
	actorID := primitive.NewObjectID()
	now := time.Unix(1_700_000_000, 0).UTC()

	var created *RegistrationDocument
	service := NewService(fakeRepository{
		findTournamentFn: func(context.Context, primitive.ObjectID) (*TournamentDocument, error) {
			return &TournamentDocument{
				ID:                   tournamentID,
				EventType:            "single",
				IsFreeRegistration:   true,
				RegOpenDate:          now.Add(-time.Hour),
				RegistrationDeadline: now.Add(time.Hour),
			}, nil
		},
		loadUsersByIDsFn: func(_ context.Context, ids []primitive.ObjectID) ([]UserDocument, error) {
			if len(ids) != 1 || ids[0] != player1ID {
				t.Fatalf("unexpected user ids: %#v", ids)
			}
			return []UserDocument{{
				ID:       player1ID,
				Name:     "Player One",
				Nickname: "p1",
				Phone:    "0912345678",
				Avatar:   "/uploads/p1.png",
			}}, nil
		},
		createRegistrationFn: func(_ context.Context, registration *RegistrationDocument) (*RegistrationDocument, error) {
			clone := *registration
			clone.ID = primitive.NewObjectID()
			created = &clone
			return &clone, nil
		},
	})
	service.now = func() time.Time { return now }

	payload, err := service.CreateRegistration(context.Background(), tournamentID.Hex(), &auth.User{ID: actorID}, CreateRegistrationInput{
		Message:   "  hello  ",
		Player1ID: player1ID.Hex(),
	})
	if err != nil {
		t.Fatalf("CreateRegistration returned error: %v", err)
	}
	if payload == nil || created == nil {
		t.Fatalf("expected created registration")
	}
	if created.Payment.Status != "Paid" || created.Payment.PaidAt == nil {
		t.Fatalf("expected paid registration, got %#v", created.Payment)
	}
	if created.CreatedBy == nil || *created.CreatedBy != actorID {
		t.Fatalf("expected createdBy to be actor")
	}
	if created.Message != "hello" {
		t.Fatalf("expected trimmed message, got %q", created.Message)
	}
}

func TestCancelRegistrationRejectsNonMember(t *testing.T) {
	registrationID := primitive.NewObjectID()
	service := NewService(fakeRepository{
		findRegistrationByIDFn: func(context.Context, primitive.ObjectID) (*RegistrationDocument, error) {
			return &RegistrationDocument{
				ID: registrationID,
				Player1: PlayerDocument{
					User: primitive.NewObjectID(),
				},
				Player2: &PlayerDocument{
					User: primitive.NewObjectID(),
				},
				CreatedBy: ptrObjectID(primitive.NewObjectID()),
			}, nil
		},
	})

	_, err := service.CancelRegistration(context.Background(), registrationID.Hex(), primitive.NewObjectID())
	if err == nil {
		t.Fatalf("expected error")
	}

	var httpErr *HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 403 {
		t.Fatalf("expected HTTP 403 error, got %v", err)
	}
}

func TestSearchRegistrationsMatchesCodeAndMasksPhone(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tournamentID := primitive.NewObjectID()
	userID := primitive.NewObjectID()
	registrationCode := int64(12345)

	service := NewService(fakeRepository{
		listRegistrationsFn: func(context.Context, primitive.ObjectID) ([]RegistrationDocument, error) {
			return []RegistrationDocument{{
				ID:         primitive.NewObjectID(),
				Code:       &registrationCode,
				Tournament: tournamentID,
				Player1: PlayerDocument{
					User:     userID,
					Phone:    "0912345678",
					FullName: "Nguyen Van A",
					NickName: "nva",
				},
				CreatedAt: time.Now().UTC(),
			}}, nil
		},
		loadUsersByIDsFn: func(_ context.Context, ids []primitive.ObjectID) ([]UserDocument, error) {
			if len(ids) != 1 || ids[0] != userID {
				t.Fatalf("unexpected user ids: %#v", ids)
			}
			return []UserDocument{{
				ID:         userID,
				FullName:   "Nguyen Van A",
				Nickname:   "nva",
				Phone:      "0912345678",
				CCCDStatus: "verified",
			}}, nil
		},
	})

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/api/registrations/"+tournamentID.Hex()+"/registrations/search?q=1234", nil)
	c.Params = gin.Params{{Key: "id", Value: tournamentID.Hex()}}

	payload, err := service.SearchRegistrations(context.Background(), c)
	if err != nil {
		t.Fatalf("SearchRegistrations returned error: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected 1 result, got %d", len(payload))
	}

	player1, ok := payload[0]["player1"].(gin.H)
	if !ok {
		t.Fatalf("expected player1 payload, got %T", payload[0]["player1"])
	}
	if phone := player1["phone"]; phone != "091****678" {
		t.Fatalf("expected masked phone, got %v", phone)
	}
	if snapshot, ok := payload[0]["player1Snapshot"].(PlayerDocument); !ok || !strings.EqualFold(snapshot.FullName, "Nguyen Van A") {
		t.Fatalf("expected player1 snapshot to be included, got %#v", payload[0]["player1Snapshot"])
	}
}

func ptrObjectID(value primitive.ObjectID) *primitive.ObjectID {
	return &value
}
