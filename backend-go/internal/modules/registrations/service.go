package registrations

import (
	"context"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"backendgo/internal/infra/auth"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/text/unicode/norm"
)

var (
	ErrInvalidTournamentID   = errors.New("tournament id is invalid")
	ErrTournamentNotFound    = errors.New("tournament not found")
	ErrInvalidRegistrationID = errors.New("registration id is invalid")
	ErrRegistrationNotFound  = errors.New("registration not found")
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

type PlayerDocument struct {
	User     primitive.ObjectID `bson:"user" json:"user"`
	Phone    string             `bson:"phone" json:"phone"`
	FullName string             `bson:"fullName" json:"fullName"`
	NickName string             `bson:"nickName,omitempty" json:"nickName,omitempty"`
	Nickname string             `bson:"nickname,omitempty" json:"nickname,omitempty"`
	Avatar   string             `bson:"avatar,omitempty" json:"avatar,omitempty"`
	Score    float64            `bson:"score" json:"score"`
}

type PaymentState struct {
	Status string     `bson:"status" json:"status"`
	PaidAt *time.Time `bson:"paidAt,omitempty" json:"paidAt,omitempty"`
}

type RegistrationDocument struct {
	ID              primitive.ObjectID  `bson:"_id" json:"_id"`
	Code            *int64              `bson:"code,omitempty" json:"code,omitempty"`
	Tournament      primitive.ObjectID  `bson:"tournament" json:"tournament"`
	TeamFactionID   *primitive.ObjectID `bson:"teamFactionId,omitempty" json:"teamFactionId,omitempty"`
	TeamFactionName string              `bson:"teamFactionName,omitempty" json:"teamFactionName,omitempty"`
	Player1         PlayerDocument      `bson:"player1" json:"player1"`
	Player2         *PlayerDocument     `bson:"player2,omitempty" json:"player2,omitempty"`
	Message         string              `bson:"message,omitempty" json:"message,omitempty"`
	Payment         PaymentState        `bson:"payment" json:"payment"`
	CheckinAt       *time.Time          `bson:"checkinAt,omitempty" json:"checkinAt,omitempty"`
	CreatedBy       *primitive.ObjectID `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedAt       time.Time           `bson:"createdAt" json:"createdAt"`
	UpdatedAt       time.Time           `bson:"updatedAt" json:"updatedAt"`
}

type TeamFactionDocument struct {
	ID          primitive.ObjectID  `bson:"_id"`
	Name        string              `bson:"name"`
	CaptainUser *primitive.ObjectID `bson:"captainUser,omitempty"`
	Order       int                 `bson:"order"`
	IsActive    *bool               `bson:"isActive,omitempty"`
}

type TeamConfigDocument struct {
	Factions []TeamFactionDocument `bson:"factions"`
}

type TournamentDocument struct {
	ID                   primitive.ObjectID  `bson:"_id"`
	CreatedBy            *primitive.ObjectID `bson:"createdBy,omitempty"`
	EventType            string              `bson:"eventType"`
	TournamentMode       string              `bson:"tournamentMode"`
	MaxPairs             int64               `bson:"maxPairs"`
	RegOpenDate          time.Time           `bson:"regOpenDate"`
	RegistrationDeadline time.Time           `bson:"registrationDeadline"`
	ScoreCap             float64             `bson:"scoreCap"`
	ScoreGap             float64             `bson:"scoreGap"`
	SingleCap            float64             `bson:"singleCap"`
	AllowExceedMaxRating bool                `bson:"allowExceedMaxRating"`
	IsFreeRegistration   bool                `bson:"isFreeRegistration"`
	Registered           int64               `bson:"registered"`
	TeamConfig           TeamConfigDocument  `bson:"teamConfig"`
}

type UserDocument struct {
	ID           primitive.ObjectID `bson:"_id"`
	Avatar       string             `bson:"avatar"`
	FullName     string             `bson:"fullName"`
	Name         string             `bson:"name"`
	NickName     string             `bson:"nickName"`
	Nickname     string             `bson:"nickname"`
	Phone        string             `bson:"phone"`
	Verified     string             `bson:"verified"`
	CCCDStatus   string             `bson:"cccdStatus"`
	Role         string             `bson:"role"`
	IsAdmin      bool               `bson:"isAdmin"`
	IsSuperUser  bool               `bson:"isSuperUser"`
	IsSuperAdmin bool               `bson:"isSuperAdmin"`
}

type ScorePair struct {
	Single float64
	Double float64
}

type CreateRegistrationInput struct {
	Message       string
	Player1ID     string
	Player2ID     string
	TeamFactionID string
}

type Repository interface {
	FindTournament(ctx context.Context, tournamentID primitive.ObjectID) (*TournamentDocument, error)
	IsTournamentManager(ctx context.Context, tournamentID, userID primitive.ObjectID) (bool, error)
	ListRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) ([]RegistrationDocument, error)
	AssignMissingCodes(ctx context.Context, registrations []RegistrationDocument) error
	LoadUsersByIDs(ctx context.Context, userIDs []primitive.ObjectID) ([]UserDocument, error)
	SetCheckin(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error)
	FindRegistrationByID(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error)
	CountMatchUsage(ctx context.Context, registrationID primitive.ObjectID) (int64, error)
	DeleteRegistration(ctx context.Context, registrationID primitive.ObjectID) error
	DecrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error
	CountRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) (int64, error)
	FindDuplicateRegistration(ctx context.Context, tournamentID primitive.ObjectID, userIDs []primitive.ObjectID) (*RegistrationDocument, error)
	LoadLatestScores(ctx context.Context, userIDs []primitive.ObjectID) (map[string]ScorePair, error)
	CreateRegistration(ctx context.Context, registration *RegistrationDocument) (*RegistrationDocument, error)
	IncrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error
}

type MongoRepository struct {
	registrations      *mongo.Collection
	tournaments        *mongo.Collection
	tournamentManagers *mongo.Collection
	users              *mongo.Collection
	matches            *mongo.Collection
	rankings           *mongo.Collection
	scoreHistories     *mongo.Collection
	counters           *mongo.Collection
	now                func() time.Time
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		registrations:      db.Collection("registrations"),
		tournaments:        db.Collection("tournaments"),
		tournamentManagers: db.Collection("tournamentmanagers"),
		users:              db.Collection("users"),
		matches:            db.Collection("matches"),
		rankings:           db.Collection("rankings"),
		scoreHistories:     db.Collection("scorehistories"),
		counters:           db.Collection("counters"),
		now:                time.Now,
	}
}

func (r *MongoRepository) FindTournament(ctx context.Context, tournamentID primitive.ObjectID) (*TournamentDocument, error) {
	var tournament TournamentDocument
	err := r.tournaments.FindOne(ctx, bson.M{"_id": tournamentID}, options.FindOne().SetProjection(bson.M{
		"createdBy":            1,
		"eventType":            1,
		"tournamentMode":       1,
		"maxPairs":             1,
		"regOpenDate":          1,
		"registrationDeadline": 1,
		"scoreCap":             1,
		"scoreGap":             1,
		"singleCap":            1,
		"allowExceedMaxRating": 1,
		"isFreeRegistration":   1,
		"registered":           1,
		"teamConfig":           1,
	})).Decode(&tournament)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tournament, nil
}

func (r *MongoRepository) IsTournamentManager(ctx context.Context, tournamentID, userID primitive.ObjectID) (bool, error) {
	count, err := r.tournamentManagers.CountDocuments(ctx, bson.M{
		"tournament": tournamentID,
		"user":       userID,
	}, options.Count().SetLimit(1))
	return count > 0, err
}

func (r *MongoRepository) ListRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) ([]RegistrationDocument, error) {
	cursor, err := r.registrations.Find(ctx, bson.M{"tournament": tournamentID}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	rows := []RegistrationDocument{}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *MongoRepository) AssignMissingCodes(ctx context.Context, registrations []RegistrationDocument) error {
	missingIndexes := make([]int, 0)
	for index, registration := range registrations {
		if registration.Code == nil {
			missingIndexes = append(missingIndexes, index)
		}
	}
	if len(missingIndexes) == 0 {
		return nil
	}

	maxCode, err := r.maxRegistrationCode(ctx)
	if err != nil {
		return err
	}
	sort.Slice(missingIndexes, func(i, j int) bool {
		return registrations[missingIndexes[i]].CreatedAt.Before(registrations[missingIndexes[j]].CreatedAt)
	})

	nextCode := maxInt64(9999, maxCode)
	for _, index := range missingIndexes {
		nextCode++
		updateResult, err := r.registrations.UpdateOne(ctx,
			bson.M{
				"_id": registrations[index].ID,
				"$or": bson.A{
					bson.M{"code": bson.M{"$exists": false}},
					bson.M{"code": nil},
				},
			},
			bson.M{"$set": bson.M{"code": nextCode}},
		)
		if err != nil {
			return err
		}
		if updateResult.ModifiedCount > 0 {
			code := nextCode
			registrations[index].Code = &code
			continue
		}

		var fresh struct {
			Code *int64 `bson:"code"`
		}
		if err := r.registrations.FindOne(ctx, bson.M{"_id": registrations[index].ID}, options.FindOne().SetProjection(bson.M{"code": 1})).Decode(&fresh); err != nil {
			return err
		}
		registrations[index].Code = fresh.Code
	}

	return nil
}

func (r *MongoRepository) LoadUsersByIDs(ctx context.Context, userIDs []primitive.ObjectID) ([]UserDocument, error) {
	if len(userIDs) == 0 {
		return []UserDocument{}, nil
	}

	cursor, err := r.users.Find(ctx, bson.M{"_id": bson.M{"$in": userIDs}}, options.Find().SetProjection(bson.M{
		"avatar":       1,
		"fullName":     1,
		"name":         1,
		"nickName":     1,
		"nickname":     1,
		"phone":        1,
		"verified":     1,
		"cccdStatus":   1,
		"role":         1,
		"isAdmin":      1,
		"isSuperUser":  1,
		"isSuperAdmin": 1,
	}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	rows := []UserDocument{}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *MongoRepository) SetCheckin(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error) {
	now := r.now().UTC()
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)

	var registration RegistrationDocument
	err := r.registrations.FindOneAndUpdate(ctx, bson.M{"_id": registrationID}, bson.M{
		"$set": bson.M{
			"checkinAt": now,
			"updatedAt": now,
		},
	}, opts).Decode(&registration)
	if err != nil {
		return nil, err
	}
	return &registration, nil
}

func (r *MongoRepository) FindRegistrationByID(ctx context.Context, registrationID primitive.ObjectID) (*RegistrationDocument, error) {
	var registration RegistrationDocument
	err := r.registrations.FindOne(ctx, bson.M{"_id": registrationID}).Decode(&registration)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &registration, nil
}

func (r *MongoRepository) CountMatchUsage(ctx context.Context, registrationID primitive.ObjectID) (int64, error) {
	return r.matches.CountDocuments(ctx, bson.M{
		"$or": bson.A{
			bson.M{"pairA": registrationID},
			bson.M{"pairB": registrationID},
			bson.M{"pairA": registrationID.Hex()},
			bson.M{"pairB": registrationID.Hex()},
		},
	})
}

func (r *MongoRepository) DeleteRegistration(ctx context.Context, registrationID primitive.ObjectID) error {
	result, err := r.registrations.DeleteOne(ctx, bson.M{"_id": registrationID})
	if err != nil {
		return err
	}
	if result.DeletedCount == 0 {
		return mongo.ErrNoDocuments
	}
	return nil
}

func (r *MongoRepository) DecrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error {
	_, err := r.tournaments.UpdateOne(ctx, bson.M{"_id": tournamentID}, mongo.Pipeline{
		{{Key: "$set", Value: bson.M{
			"registered": bson.M{"$max": bson.A{
				0,
				bson.M{"$subtract": bson.A{bson.M{"$ifNull": bson.A{"$registered", 0}}, 1}},
			}},
			"updatedAt": r.now().UTC(),
		}}},
	})
	return err
}

func (r *MongoRepository) CountRegistrationsByTournament(ctx context.Context, tournamentID primitive.ObjectID) (int64, error) {
	return r.registrations.CountDocuments(ctx, bson.M{"tournament": tournamentID})
}

func (r *MongoRepository) FindDuplicateRegistration(ctx context.Context, tournamentID primitive.ObjectID, userIDs []primitive.ObjectID) (*RegistrationDocument, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}

	ors := make([]bson.M, 0, len(userIDs)*2)
	for _, userID := range userIDs {
		ors = append(ors,
			bson.M{"player1.user": userID},
			bson.M{"player2.user": userID},
		)
	}

	var registration RegistrationDocument
	err := r.registrations.FindOne(ctx, bson.M{
		"tournament": tournamentID,
		"$or":        ors,
	}).Decode(&registration)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &registration, nil
}

func (r *MongoRepository) LoadLatestScores(ctx context.Context, userIDs []primitive.ObjectID) (map[string]ScorePair, error) {
	scoreMap := make(map[string]ScorePair, len(userIDs))
	if len(userIDs) == 0 {
		return scoreMap, nil
	}

	cursor, err := r.rankings.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"user": bson.M{"$in": userIDs}}}},
		{{Key: "$project", Value: bson.M{
			"user":   1,
			"single": bson.M{"$ifNull": bson.A{"$single", bson.M{"$ifNull": bson.A{"$singleScore", "$singlePoint"}}}},
			"double": bson.M{"$ifNull": bson.A{"$double", bson.M{"$ifNull": bson.A{"$doubleScore", "$doublePoint"}}}},
		}}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var rankingRows []struct {
		User   primitive.ObjectID `bson:"user"`
		Single float64            `bson:"single"`
		Double float64            `bson:"double"`
	}
	if err := cursor.All(ctx, &rankingRows); err != nil {
		return nil, err
	}
	for _, row := range rankingRows {
		scoreMap[row.User.Hex()] = ScorePair{Single: row.Single, Double: row.Double}
	}

	remaining := make([]primitive.ObjectID, 0)
	for _, userID := range userIDs {
		if _, ok := scoreMap[userID.Hex()]; !ok {
			remaining = append(remaining, userID)
		}
	}
	if len(remaining) == 0 {
		return scoreMap, nil
	}

	historyCursor, err := r.scoreHistories.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"user": bson.M{"$in": remaining}}}},
		{{Key: "$sort", Value: bson.D{{Key: "scoredAt", Value: -1}}}},
		{{Key: "$group", Value: bson.M{
			"_id":    "$user",
			"single": bson.M{"$first": "$single"},
			"double": bson.M{"$first": "$double"},
		}}},
	})
	if err != nil {
		return nil, err
	}
	defer historyCursor.Close(ctx)

	var historyRows []struct {
		ID     primitive.ObjectID `bson:"_id"`
		Single float64            `bson:"single"`
		Double float64            `bson:"double"`
	}
	if err := historyCursor.All(ctx, &historyRows); err != nil {
		return nil, err
	}
	for _, row := range historyRows {
		scoreMap[row.ID.Hex()] = ScorePair{Single: row.Single, Double: row.Double}
	}

	return scoreMap, nil
}

func (r *MongoRepository) CreateRegistration(ctx context.Context, registration *RegistrationDocument) (*RegistrationDocument, error) {
	if registration == nil {
		return nil, errors.New("registration is nil")
	}

	now := r.now().UTC()
	if registration.ID == primitive.NilObjectID {
		registration.ID = primitive.NewObjectID()
	}
	registration.CreatedAt = now
	registration.UpdatedAt = now

	for attempt := 0; attempt < 3; attempt++ {
		code, err := r.nextRegistrationCode(ctx)
		if err != nil {
			return nil, err
		}
		registration.Code = &code

		_, err = r.registrations.InsertOne(ctx, registration)
		if err == nil {
			return registration, nil
		}
		if !strings.Contains(strings.ToLower(err.Error()), "duplicate key") || !strings.Contains(strings.ToLower(err.Error()), "code") {
			return nil, err
		}
	}

	return nil, errors.New("failed to allocate unique registration code")
}

func (r *MongoRepository) IncrementTournamentRegistered(ctx context.Context, tournamentID primitive.ObjectID) error {
	_, err := r.tournaments.UpdateOne(ctx, bson.M{"_id": tournamentID}, bson.M{
		"$inc": bson.M{"registered": 1},
		"$set": bson.M{"updatedAt": r.now().UTC()},
	})
	return err
}

func (r *MongoRepository) maxRegistrationCode(ctx context.Context) (int64, error) {
	var row struct {
		Code *int64 `bson:"code"`
	}
	err := r.registrations.FindOne(ctx, bson.M{"code": bson.M{"$type": "number"}}, options.FindOne().
		SetSort(bson.D{{Key: "code", Value: -1}}).
		SetProjection(bson.M{"code": 1})).
		Decode(&row)
	if errors.Is(err, mongo.ErrNoDocuments) || row.Code == nil {
		return 9999, nil
	}
	if err != nil {
		return 0, err
	}
	return *row.Code, nil
}

func (r *MongoRepository) nextRegistrationCode(ctx context.Context) (int64, error) {
	var row struct {
		Seq int64 `bson:"seq"`
	}
	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	err := r.counters.FindOneAndUpdate(ctx, bson.M{"_id": "registration_code"}, mongo.Pipeline{
		{{Key: "$set", Value: bson.M{
			"seq": bson.M{"$add": bson.A{bson.M{"$ifNull": bson.A{"$seq", 9999}}, 1}},
		}}},
	}, opts).Decode(&row)
	if err == nil {
		return row.Seq, nil
	}

	if _, updateErr := r.counters.UpdateOne(ctx,
		bson.M{"_id": "registration_code"},
		bson.M{"$setOnInsert": bson.M{"seq": 9999}},
		options.Update().SetUpsert(true),
	); updateErr != nil {
		return 0, updateErr
	}

	err = r.counters.FindOneAndUpdate(ctx, bson.M{"_id": "registration_code"}, bson.M{
		"$inc": bson.M{"seq": 1},
	}, opts).Decode(&row)
	if err != nil {
		return 0, err
	}
	return row.Seq, nil
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{
		repository: repository,
		now:        time.Now,
	}
}

func (s *Service) GetRegistrations(ctx context.Context, c *gin.Context) ([]gin.H, error) {
	tournamentID, err := primitive.ObjectIDFromHex(strings.TrimSpace(c.Param("id")))
	if err != nil {
		return nil, ErrInvalidTournamentID
	}

	user, _ := auth.CurrentUser(c)
	return s.listAndSerializeRegistrations(ctx, tournamentID, user, false, "", 0)
}

func (s *Service) SearchRegistrations(ctx context.Context, c *gin.Context) ([]gin.H, error) {
	tournamentID, err := primitive.ObjectIDFromHex(strings.TrimSpace(c.Param("id")))
	if err != nil {
		return nil, ErrInvalidTournamentID
	}

	limit := parseSearchLimit(c.Query("limit"))
	user, _ := auth.CurrentUser(c)
	return s.listAndSerializeRegistrations(ctx, tournamentID, user, true, c.Query("q"), limit)
}

func (s *Service) CheckinRegistration(ctx context.Context, registrationID string) (*RegistrationDocument, error) {
	regID, err := primitive.ObjectIDFromHex(strings.TrimSpace(registrationID))
	if err != nil {
		return nil, ErrInvalidRegistrationID
	}

	registration, err := s.repository.SetCheckin(ctx, regID)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrRegistrationNotFound
		}
		return nil, err
	}
	return registration, nil
}

func (s *Service) CancelRegistration(ctx context.Context, registrationID string, actorID primitive.ObjectID) (gin.H, error) {
	regID, err := primitive.ObjectIDFromHex(strings.TrimSpace(registrationID))
	if err != nil {
		return nil, ErrInvalidRegistrationID
	}

	registration, err := s.repository.FindRegistrationByID(ctx, regID)
	if err != nil {
		return nil, err
	}
	if registration == nil {
		return nil, ErrRegistrationNotFound
	}

	isOwner := registration.CreatedBy != nil && registration.CreatedBy.Hex() == actorID.Hex()
	isMember := registration.Player1.User == actorID || (registration.Player2 != nil && registration.Player2.User == actorID)
	if !isOwner && !isMember {
		return nil, &HTTPError{StatusCode: http.StatusForbidden, Message: "Ban khong co quyen huy dang ky nay"}
	}

	tournament, err := s.repository.FindTournament(ctx, registration.Tournament)
	if err != nil {
		return nil, err
	}
	if tournament != nil && !tournament.IsFreeRegistration && strings.EqualFold(registration.Payment.Status, "Paid") {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Dang ky da thanh toan, khong the huy"}
	}

	usedInMatches, err := s.repository.CountMatchUsage(ctx, regID)
	if err != nil {
		return nil, err
	}
	if usedInMatches > 0 {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Dang ky da duoc xep vao tran dau, khong the huy"}
	}

	if err := s.repository.DeleteRegistration(ctx, regID); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrRegistrationNotFound
		}
		return nil, err
	}
	if tournament != nil {
		if err := s.repository.DecrementTournamentRegistered(ctx, registration.Tournament); err != nil {
			return nil, err
		}
	}

	return gin.H{"ok": true, "message": "Da huy dang ky"}, nil
}

func (s *Service) CreateRegistration(ctx context.Context, tournamentID string, actor *auth.User, input CreateRegistrationInput) (*RegistrationDocument, error) {
	if actor == nil {
		return nil, &HTTPError{StatusCode: http.StatusUnauthorized, Message: "Unauthorized"}
	}

	tourID, err := primitive.ObjectIDFromHex(strings.TrimSpace(tournamentID))
	if err != nil {
		return nil, ErrInvalidTournamentID
	}

	tournament, err := s.repository.FindTournament(ctx, tourID)
	if err != nil {
		return nil, err
	}
	if tournament == nil {
		return nil, ErrTournamentNotFound
	}

	isSingles := isSinglesEvent(tournament.EventType)
	isDoubles := isDoublesEvent(tournament.EventType)
	if !isSingles && !isDoubles {
		isDoubles = true
	}

	if tournament.MaxPairs > 0 {
		currentCount, err := s.repository.CountRegistrationsByTournament(ctx, tourID)
		if err != nil {
			return nil, err
		}
		if currentCount >= tournament.MaxPairs {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Giai da du so cap dang ky"}
		}
	}

	now := s.now().UTC()
	if tournament.RegOpenDate.IsZero() || tournament.RegistrationDeadline.IsZero() || now.Before(tournament.RegOpenDate) || now.After(tournament.RegistrationDeadline) {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Giai chua mo hoac da het han dang ky"}
	}

	if strings.TrimSpace(input.Player1ID) == "" {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Thieu VDV 1"}
	}

	player1ID, err := primitive.ObjectIDFromHex(strings.TrimSpace(input.Player1ID))
	if err != nil {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Khong tim thay VDV hop le"}
	}

	playerIDs := []primitive.ObjectID{player1ID}
	if isSingles {
		if strings.TrimSpace(input.Player2ID) != "" {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Giai don chi cho phep 1 VDV"}
		}
	} else {
		if strings.TrimSpace(input.Player2ID) == "" {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Giai doi can 2 VDV"}
		}
		player2ID, err := primitive.ObjectIDFromHex(strings.TrimSpace(input.Player2ID))
		if err != nil {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Khong tim thay VDV hop le"}
		}
		if player1ID == player2ID {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Hai VDV phai khac nhau"}
		}
		playerIDs = append(playerIDs, player2ID)
	}

	var activeFaction *TeamFactionDocument
	if isTeamTournament(tournament) {
		activeFaction = findActiveFaction(tournament, input.TeamFactionID)
		if activeFaction == nil {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Giai dong doi yeu cau chon phe hop le"}
		}

		allowed, err := s.canManageTeamFaction(ctx, actor, tournament, activeFaction)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, &HTTPError{
				StatusCode: http.StatusForbidden,
				Message:    "Chi doi truong cua phe nay hoac quan ly giai moi duoc them roster",
			}
		}
	}

	users, err := s.repository.LoadUsersByIDs(ctx, playerIDs)
	if err != nil {
		return nil, err
	}
	if len(users) != len(playerIDs) {
		return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Khong tim thay VDV hop le"}
	}

	userByID := make(map[string]UserDocument, len(users))
	for _, user := range users {
		userByID[user.ID.Hex()] = user
	}

	duplicate, err := s.repository.FindDuplicateRegistration(ctx, tourID, playerIDs)
	if err != nil {
		return nil, err
	}
	if duplicate != nil {
		return nil, &HTTPError{
			StatusCode: http.StatusBadRequest,
			Message:    duplicateRegistrationMessage(duplicate, playerIDs, isSingles),
		}
	}

	scoreMap, err := s.repository.LoadLatestScores(ctx, playerIDs)
	if err != nil {
		return nil, err
	}

	scoreKey := "double"
	if isSingles {
		scoreKey = "single"
	}
	score1 := pickScore(scoreMap[player1ID.Hex()], scoreKey)
	score2 := 0.0
	if len(playerIDs) > 1 {
		score2 = pickScore(scoreMap[playerIDs[1].Hex()], scoreKey)
	}

	if !isZeroScoreCap(tournament.ScoreCap) && !tournament.AllowExceedMaxRating {
		if tournament.SingleCap > 0 && (roundMilli(score1) > roundMilli(tournament.SingleCap) || (len(playerIDs) > 1 && roundMilli(score2) > roundMilli(tournament.SingleCap))) {
			return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Diem cua 1 VDV vuot gioi han"}
		}
		if isDoubles && tournament.ScoreCap > 0 {
			if roundMilli(score1+score2) > roundMilli(tournament.ScoreCap+tournament.ScoreGap) {
				return nil, &HTTPError{StatusCode: http.StatusBadRequest, Message: "Tong diem doi vuot gioi han cua giai"}
			}
		}
	}

	player1User := userByID[player1ID.Hex()]
	player1 := PlayerDocument{
		User:     player1User.ID,
		Phone:    strings.TrimSpace(player1User.Phone),
		FullName: firstNonEmpty(strings.TrimSpace(player1User.Name), strings.TrimSpace(player1User.FullName), strings.TrimSpace(player1User.Nickname)),
		NickName: firstNonEmpty(strings.TrimSpace(player1User.Nickname), strings.TrimSpace(player1User.NickName)),
		Avatar:   strings.TrimSpace(player1User.Avatar),
		Score:    score1,
	}

	var player2 *PlayerDocument
	if len(playerIDs) > 1 {
		player2User := userByID[playerIDs[1].Hex()]
		player2 = &PlayerDocument{
			User:     player2User.ID,
			Phone:    strings.TrimSpace(player2User.Phone),
			FullName: firstNonEmpty(strings.TrimSpace(player2User.Name), strings.TrimSpace(player2User.FullName), strings.TrimSpace(player2User.Nickname)),
			NickName: firstNonEmpty(strings.TrimSpace(player2User.Nickname), strings.TrimSpace(player2User.NickName)),
			Avatar:   strings.TrimSpace(player2User.Avatar),
			Score:    score2,
		}
	}

	payment := PaymentState{Status: "Unpaid"}
	if tournament.IsFreeRegistration {
		paidAt := now
		payment = PaymentState{
			Status: "Paid",
			PaidAt: &paidAt,
		}
	}

	registration := &RegistrationDocument{
		Tournament:      tourID,
		TeamFactionName: "",
		Player1:         player1,
		Player2:         player2,
		Message:         strings.TrimSpace(input.Message),
		Payment:         payment,
		CreatedBy:       &actor.ID,
	}
	if activeFaction != nil {
		factionID := activeFaction.ID
		registration.TeamFactionID = &factionID
		registration.TeamFactionName = strings.TrimSpace(activeFaction.Name)
	}

	created, err := s.repository.CreateRegistration(ctx, registration)
	if err != nil {
		return nil, err
	}
	if err := s.repository.IncrementTournamentRegistered(ctx, tourID); err != nil {
		return nil, err
	}

	return created, nil
}

func (s *Service) listAndSerializeRegistrations(ctx context.Context, tournamentID primitive.ObjectID, actor *auth.User, includeSnapshots bool, rawQuery string, limit int) ([]gin.H, error) {
	canSeeFullPhone, err := s.canSeeFullPhone(ctx, tournamentID, actor)
	if err != nil {
		return nil, err
	}

	registrations, err := s.repository.ListRegistrationsByTournament(ctx, tournamentID)
	if err != nil {
		return nil, err
	}
	if err := s.repository.AssignMissingCodes(ctx, registrations); err != nil {
		return nil, err
	}

	userIDs := collectRegistrationUserIDs(registrations)
	users, err := s.repository.LoadUsersByIDs(ctx, userIDs)
	if err != nil {
		return nil, err
	}
	userByID := make(map[string]UserDocument, len(users))
	for _, user := range users {
		userByID[user.ID.Hex()] = user
	}

	query := strings.TrimSpace(rawQuery)
	if query == "" {
		payload := make([]gin.H, 0, len(registrations))
		for _, registration := range registrations {
			payload = append(payload, buildRegistrationPayload(registration, userByID, canSeeFullPhone, includeSnapshots))
		}
		if includeSnapshots && limit > 0 && len(payload) > limit {
			return payload[:limit], nil
		}
		return payload, nil
	}

	type scoredResult struct {
		payload   gin.H
		score     int
		createdAt time.Time
	}

	results := make([]scoredResult, 0)
	for _, registration := range registrations {
		score, ok := searchScoreRegistration(registration, userByID, query)
		if !ok {
			continue
		}
		results = append(results, scoredResult{
			payload:   buildRegistrationPayload(registration, userByID, canSeeFullPhone, includeSnapshots),
			score:     score,
			createdAt: registration.CreatedAt,
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].score != results[j].score {
			return results[i].score > results[j].score
		}
		return results[i].createdAt.After(results[j].createdAt)
	})

	payload := make([]gin.H, 0, len(results))
	for _, item := range results {
		payload = append(payload, item.payload)
		if limit > 0 && len(payload) >= limit {
			break
		}
	}
	return payload, nil
}

func (s *Service) canSeeFullPhone(ctx context.Context, tournamentID primitive.ObjectID, actor *auth.User) (bool, error) {
	if actor == nil {
		return false, nil
	}
	if isAdminUser(actor) {
		return true, nil
	}

	tournament, err := s.repository.FindTournament(ctx, tournamentID)
	if err != nil {
		return false, err
	}
	if tournament != nil && tournament.CreatedBy != nil && tournament.CreatedBy.Hex() == actor.ID.Hex() {
		return true, nil
	}

	return s.repository.IsTournamentManager(ctx, tournamentID, actor.ID)
}

func (s *Service) canManageTeamFaction(ctx context.Context, actor *auth.User, tournament *TournamentDocument, faction *TeamFactionDocument) (bool, error) {
	if actor == nil || tournament == nil || faction == nil {
		return false, nil
	}
	if isAdminUser(actor) {
		return true, nil
	}
	if tournament.CreatedBy != nil && tournament.CreatedBy.Hex() == actor.ID.Hex() {
		return true, nil
	}

	isManager, err := s.repository.IsTournamentManager(ctx, tournament.ID, actor.ID)
	if err != nil {
		return false, err
	}
	if isManager {
		return true, nil
	}

	return faction.CaptainUser != nil && faction.CaptainUser.Hex() == actor.ID.Hex(), nil
}

func buildRegistrationPayload(registration RegistrationDocument, userByID map[string]UserDocument, canSeeFullPhone bool, includeSnapshots bool) gin.H {
	payload := gin.H{
		"_id":             registration.ID,
		"code":            registration.Code,
		"tournament":      registration.Tournament,
		"teamFactionId":   registration.TeamFactionID,
		"teamFactionName": registration.TeamFactionName,
		"message":         registration.Message,
		"payment":         registration.Payment,
		"checkinAt":       registration.CheckinAt,
		"createdBy":       registration.CreatedBy,
		"createdAt":       registration.CreatedAt,
		"updatedAt":       registration.UpdatedAt,
		"player1":         enrichPlayer(registration.Player1, userByID, canSeeFullPhone),
		"player2":         enrichOptionalPlayer(registration.Player2, userByID, canSeeFullPhone),
	}

	if includeSnapshots {
		payload["player1Snapshot"] = registration.Player1
		payload["player2Snapshot"] = registration.Player2
	}

	return payload
}

func enrichOptionalPlayer(player *PlayerDocument, userByID map[string]UserDocument, canSeeFullPhone bool) any {
	if player == nil {
		return nil
	}
	return enrichPlayer(*player, userByID, canSeeFullPhone)
}

func enrichPlayer(player PlayerDocument, userByID map[string]UserDocument, canSeeFullPhone bool) gin.H {
	user := userByID[player.User.Hex()]
	fullName := firstNonEmpty(strings.TrimSpace(user.FullName), strings.TrimSpace(user.Name), strings.TrimSpace(player.FullName))
	nickName := firstNonEmpty(strings.TrimSpace(user.NickName), strings.TrimSpace(user.Nickname), strings.TrimSpace(player.NickName), strings.TrimSpace(player.Nickname))
	phoneSource := firstNonEmpty(strings.TrimSpace(user.Phone), strings.TrimSpace(player.Phone))
	kycStatus := finalKYCStatus(user)

	return gin.H{
		"user":           player.User,
		"phone":          maskPhone(phoneSource, canSeeFullPhone),
		"fullName":       fullName,
		"nickName":       nickName,
		"avatar":         firstNonEmpty(strings.TrimSpace(user.Avatar), strings.TrimSpace(player.Avatar)),
		"score":          player.Score,
		"cccdStatus":     firstNonEmpty(user.CCCDStatus, "unverified"),
		"verifiedLegacy": firstNonEmpty(user.Verified, "pending"),
		"kycStatus":      kycStatus,
		"isVerified":     kycStatus == "verified",
	}
}

func collectRegistrationUserIDs(registrations []RegistrationDocument) []primitive.ObjectID {
	seen := make(map[string]primitive.ObjectID)
	for _, registration := range registrations {
		if registration.Player1.User != primitive.NilObjectID {
			seen[registration.Player1.User.Hex()] = registration.Player1.User
		}
		if registration.Player2 != nil && registration.Player2.User != primitive.NilObjectID {
			seen[registration.Player2.User.Hex()] = registration.Player2.User
		}
	}

	ids := make([]primitive.ObjectID, 0, len(seen))
	for _, id := range seen {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].Hex() < ids[j].Hex() })
	return ids
}

func finalKYCStatus(user UserDocument) string {
	status := strings.ToLower(strings.TrimSpace(user.CCCDStatus))
	switch status {
	case "verified", "pending", "rejected":
		return status
	}
	if strings.EqualFold(strings.TrimSpace(user.Verified), "verified") {
		return "verified"
	}
	if strings.EqualFold(strings.TrimSpace(user.Verified), "pending") {
		return "pending"
	}
	return "unverified"
}

func maskPhone(value string, canSeeFullPhone bool) string {
	if canSeeFullPhone {
		return value
	}
	if len(value) <= 6 {
		head := 1
		if len(value) < head {
			head = len(value)
		}
		tail := 0
		if len(value) > 2 {
			tail = 1
		}
		stars := strings.Repeat("*", maxInt(0, len(value)-head-tail))
		return value[:head] + stars + value[len(value)-tail:]
	}
	return value[:3] + "****" + value[len(value)-3:]
}

func searchScoreRegistration(registration RegistrationDocument, userByID map[string]UserDocument, rawQuery string) (int, bool) {
	query := normalizeSearchText(rawQuery)
	if query == "" {
		return 0, true
	}

	digits := normalizeDigits(rawQuery)
	score := -1

	fields := registrationSearchFields(registration, userByID)
	for _, field := range fields {
		if field == "" {
			continue
		}
		if field == query {
			score = maxInt(score, 850)
		}
		if strings.HasPrefix(field, query) {
			score = maxInt(score, 760)
		}
		if strings.Contains(field, query) {
			score = maxInt(score, 650)
		}
	}

	if digits != "" {
		if registration.Code != nil {
			codeString := strconv.FormatInt(*registration.Code, 10)
			if codeString == digits {
				score = maxInt(score, 1000)
			} else if strings.HasPrefix(codeString, digits) {
				score = maxInt(score, 920)
			}
		}
		for _, phone := range registrationPhoneSources(registration, userByID) {
			normalizedPhone := normalizeDigits(phone)
			if normalizedPhone == "" {
				continue
			}
			if normalizedPhone == digits {
				score = maxInt(score, 980)
			} else if strings.Contains(normalizedPhone, digits) {
				score = maxInt(score, 950)
			}
		}
	}

	shortID := strings.ToLower(lastN(registration.ID.Hex(), 5))
	rawQueryTrimmed := strings.ToLower(strings.TrimSpace(rawQuery))
	if rawQueryTrimmed != "" && strings.HasPrefix(shortID, rawQueryTrimmed) {
		score = maxInt(score, 620)
	}

	tokens := strings.Fields(query)
	if len(tokens) > 0 {
		prefixHits := 0
		containsHits := 0
		for _, token := range tokens {
			if token == "" {
				continue
			}
			if anyFieldHasWordPrefix(fields, token) {
				prefixHits++
			}
			if anyFieldContains(fields, token) {
				containsHits++
			}
		}
		if prefixHits == len(tokens) {
			score = maxInt(score, 800+len(tokens))
		} else if prefixHits > 0 {
			score = maxInt(score, 700+prefixHits)
		}
		if containsHits == len(tokens) {
			score = maxInt(score, 680+len(tokens))
		} else if containsHits > 0 {
			score = maxInt(score, 600+containsHits)
		}
	}

	return score, score >= 0
}

func registrationSearchFields(registration RegistrationDocument, userByID map[string]UserDocument) []string {
	fields := []string{
		normalizeSearchText(firstNonEmpty(playerFullName(registration.Player1, userByID), playerNickName(registration.Player1, userByID))),
		normalizeSearchText(firstNonEmpty(playerNickName(registration.Player1, userByID), playerFullName(registration.Player1, userByID))),
	}
	if registration.Player2 != nil {
		fields = append(fields,
			normalizeSearchText(firstNonEmpty(playerFullName(*registration.Player2, userByID), playerNickName(*registration.Player2, userByID))),
			normalizeSearchText(firstNonEmpty(playerNickName(*registration.Player2, userByID), playerFullName(*registration.Player2, userByID))),
		)
	}
	return fields
}

func registrationPhoneSources(registration RegistrationDocument, userByID map[string]UserDocument) []string {
	values := []string{
		playerPhone(registration.Player1, userByID),
	}
	if registration.Player2 != nil {
		values = append(values, playerPhone(*registration.Player2, userByID))
	}
	return values
}

func playerFullName(player PlayerDocument, userByID map[string]UserDocument) string {
	user := userByID[player.User.Hex()]
	return firstNonEmpty(user.FullName, user.Name, player.FullName)
}

func playerNickName(player PlayerDocument, userByID map[string]UserDocument) string {
	user := userByID[player.User.Hex()]
	return firstNonEmpty(user.NickName, user.Nickname, player.NickName, player.Nickname)
}

func playerPhone(player PlayerDocument, userByID map[string]UserDocument) string {
	user := userByID[player.User.Hex()]
	return firstNonEmpty(user.Phone, player.Phone)
}

func normalizeSearchText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	decomposed := norm.NFD.String(strings.ToLower(value))
	builder := strings.Builder{}
	for _, r := range decomposed {
		switch {
		case r == rune(273) || r == rune(272):
			builder.WriteRune('d')
		case unicode.Is(unicode.Mn, r):
			continue
		default:
			builder.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(builder.String()), " ")
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

func anyFieldHasWordPrefix(fields []string, token string) bool {
	for _, field := range fields {
		for _, word := range strings.Fields(field) {
			if strings.HasPrefix(word, token) {
				return true
			}
		}
	}
	return false
}

func anyFieldContains(fields []string, token string) bool {
	for _, field := range fields {
		if strings.Contains(field, token) {
			return true
		}
	}
	return false
}

func findActiveFaction(tournament *TournamentDocument, factionID string) *TeamFactionDocument {
	if tournament == nil {
		return nil
	}
	target := strings.TrimSpace(factionID)
	if target == "" {
		return nil
	}

	for index := range tournament.TeamConfig.Factions {
		faction := &tournament.TeamConfig.Factions[index]
		if faction.ID.Hex() != target {
			continue
		}
		if faction.IsActive != nil && !*faction.IsActive {
			return nil
		}
		return faction
	}
	return nil
}

func isAdminUser(user *auth.User) bool {
	if user == nil {
		return false
	}
	if user.IsAdmin || user.IsSuperUser || user.IsSuperAdmin {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(user.Role), "admin") {
		return true
	}
	for _, role := range user.Roles {
		normalized := strings.ToLower(strings.TrimSpace(role))
		if normalized == "admin" || normalized == "superuser" || normalized == "superadmin" {
			return true
		}
	}
	return false
}

func isTeamTournament(tournament *TournamentDocument) bool {
	return tournament != nil && strings.EqualFold(strings.TrimSpace(tournament.TournamentMode), "team")
}

func isSinglesEvent(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "single" || normalized == "singles"
}

func isDoublesEvent(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "double" || normalized == "doubles" || normalized == ""
}

func parseSearchLimit(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return 200
	}
	if value > 500 {
		return 500
	}
	return value
}

func duplicateRegistrationMessage(registration *RegistrationDocument, requestedIDs []primitive.ObjectID, isSingles bool) string {
	requested := make(map[string]struct{}, len(requestedIDs))
	for _, userID := range requestedIDs {
		requested[userID.Hex()] = struct{}{}
	}

	names := []string{}
	if _, ok := requested[registration.Player1.User.Hex()]; ok {
		names = append(names, firstNonEmpty(registration.Player1.NickName, registration.Player1.Nickname, registration.Player1.FullName, "VDV"))
	}
	if registration.Player2 != nil {
		if _, ok := requested[registration.Player2.User.Hex()]; ok {
			names = append(names, firstNonEmpty(registration.Player2.NickName, registration.Player2.Nickname, registration.Player2.FullName, "VDV"))
		}
	}

	if isSingles {
		return "Ban da dang ky giai dau roi"
	}
	if len(names) >= 2 {
		return "Ca 2 VDV da dang ky giai dau roi"
	}
	return "Van dong vien " + firstNonEmpty(firstString(names), "VDV") + " da dang ky giai dau roi"
}

func pickScore(score ScorePair, key string) float64 {
	if key == "single" {
		return score.Single
	}
	return score.Double
}

func isZeroScoreCap(value float64) bool {
	return math.Abs(value) < 0.0000001
}

func roundMilli(value float64) int64 {
	return int64(math.Round(value * 1000))
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func lastN(value string, n int) string {
	if n <= 0 || len(value) <= n {
		return value
	}
	return value[len(value)-n:]
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
