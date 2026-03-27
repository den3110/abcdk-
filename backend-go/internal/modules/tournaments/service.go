package tournaments

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"backendgo/internal/infra/httpx"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var (
	ErrInvalidTournamentID = errors.New("invalid tournament id")
	ErrTournamentNotFound  = errors.New("tournament not found")
	ErrInvalidMatchID      = errors.New("invalid match id")
	ErrMatchNotFound       = errors.New("match not found")
)

type MongoRepository struct {
	tournaments        *mongo.Collection
	registrations      *mongo.Collection
	brackets           *mongo.Collection
	matches            *mongo.Collection
	courts             *mongo.Collection
	drawSessions       *mongo.Collection
	liveRecordingsV2   *mongo.Collection
	tournamentManagers *mongo.Collection
	courtClusters      *mongo.Collection
	users              *mongo.Collection
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		tournaments:        db.Collection("tournaments"),
		registrations:      db.Collection("registrations"),
		brackets:           db.Collection("brackets"),
		matches:            db.Collection("matches"),
		courts:             db.Collection("courts"),
		drawSessions:       db.Collection("drawsessions"),
		liveRecordingsV2:   db.Collection("liverecordingv2"),
		tournamentManagers: db.Collection("tournamentmanagers"),
		courtClusters:      db.Collection("courtclusters"),
		users:              db.Collection("users"),
	}
}

type Service struct {
	repository *MongoRepository
}

func NewService(repository *MongoRepository) *Service {
	return &Service{repository: repository}
}

func (s *Service) List(c *gin.Context) ([]bson.M, error) {
	ctx := c.Request.Context()
	rawKeyword := strings.TrimSpace(firstNonEmpty(c.Query("keyword"), c.Query("q")))
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	sortSpec := parseSort(c.Query("sort"))
	limit := parseOptionalLimit(c.Query("limit"))

	pipeline := mongo.Pipeline{}
	if rawKeyword != "" {
		match := buildKeywordMatch(rawKeyword)
		if len(match) > 0 {
			pipeline = append(pipeline, bson.D{{Key: "$match", Value: match}})
		}
	}

	pipeline = append(pipeline,
		bson.D{{Key: "$addFields", Value: bson.M{
			"_startInstant": bson.M{"$ifNull": bson.A{"$startAt", "$startDate"}},
			"_endInstant": bson.M{"$ifNull": bson.A{
				bson.M{"$ifNull": bson.A{"$endAt", "$endDate"}},
				bson.M{"$ifNull": bson.A{"$startAt", "$startDate"}},
			}},
		}}},
		bson.D{{Key: "$addFields", Value: bson.M{
			"_isOngoing": bson.M{"$and": bson.A{
				bson.M{"$lte": bson.A{"$_startInstant", "$$NOW"}},
				bson.M{"$gte": bson.A{"$_endInstant", "$$NOW"}},
			}},
			"_isUpcoming": bson.M{"$gt": bson.A{"$_startInstant", "$$NOW"}},
		}}},
		bson.D{{Key: "$addFields", Value: bson.M{
			"nearDeltaMs": bson.M{"$cond": bson.A{
				"$_isOngoing",
				0,
				bson.M{"$cond": bson.A{
					"$_isUpcoming",
					bson.M{"$subtract": bson.A{"$_startInstant", "$$NOW"}},
					bson.M{"$subtract": bson.A{"$$NOW", "$_endInstant"}},
				}},
			}},
			"tieMs": bson.M{"$cond": bson.A{
				"$_isOngoing",
				bson.M{"$max": bson.A{0, bson.M{"$subtract": bson.A{"$_endInstant", "$$NOW"}}}},
				bson.M{"$cond": bson.A{
					"$_isUpcoming",
					bson.M{"$max": bson.A{0, bson.M{"$subtract": bson.A{"$_startInstant", "$$NOW"}}}},
					bson.M{"$max": bson.A{0, bson.M{"$subtract": bson.A{"$$NOW", "$_endInstant"}}}},
				}},
			}},
		}}},
	)

	if status == "upcoming" || status == "ongoing" || status == "finished" {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: bson.M{"status": status}}})
	}

	sortStage := bson.D{
		{Key: "nearDeltaMs", Value: 1},
		{Key: "tieMs", Value: 1},
	}
	sortStage = append(sortStage, sortSpec...)
	sortStage = append(sortStage, bson.E{Key: "_id", Value: -1})
	pipeline = append(pipeline, bson.D{{Key: "$sort", Value: sortStage}})
	if limit > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$limit", Value: limit}})
	}

	pipeline = append(pipeline,
		bson.D{{Key: "$lookup", Value: bson.M{
			"from": "registrations",
			"let":  bson.M{"tid": "$_id"},
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$match", Value: bson.M{"$expr": bson.M{"$eq": bson.A{"$tournament", "$$tid"}}}}},
				bson.D{{Key: "$group", Value: bson.M{"_id": nil, "c": bson.M{"$sum": 1}}}},
			},
			"as": "_rc",
		}}},
		bson.D{{Key: "$addFields", Value: bson.M{
			"registered": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_rc.c", 0}}, 0}},
			"isFull": bson.M{"$cond": bson.A{
				bson.M{"$and": bson.A{
					bson.M{"$gt": bson.A{"$maxPairs", 0}},
					bson.M{"$gte": bson.A{bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_rc.c", 0}}, 0}}, "$maxPairs"}},
				}},
				true,
				false,
			}},
			"remaining": bson.M{"$cond": bson.A{
				bson.M{"$gt": bson.A{"$maxPairs", 0}},
				bson.M{"$max": bson.A{
					0,
					bson.M{"$subtract": bson.A{"$maxPairs", bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_rc.c", 0}}, 0}}}},
				}},
				nil,
			}},
		}}},
		bson.D{{Key: "$lookup", Value: bson.M{
			"from": "brackets",
			"let":  bson.M{"tid": "$_id"},
			"pipeline": mongo.Pipeline{
				bson.D{{Key: "$match", Value: bson.M{"$expr": bson.M{"$eq": bson.A{"$tournament", "$$tid"}}}}},
				bson.D{{Key: "$group", Value: bson.M{
					"_id":      nil,
					"total":    bson.M{"$sum": 1},
					"noRankOn": bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$noRankDelta", true}}, 1, 0}}},
				}}},
			},
			"as": "_bc",
		}}},
		bson.D{{Key: "$addFields", Value: bson.M{
			"bracketsTotal":           bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.total", 0}}, 0}},
			"bracketsNoRankDeltaTrue": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.noRankOn", 0}}, 0}},
			"allBracketsNoRankDelta": bson.M{"$cond": bson.A{
				bson.M{"$gt": bson.A{bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.total", 0}}, 0}}, 0}},
				bson.M{"$eq": bson.A{
					bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.noRankOn", 0}}, 0}},
					bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.total", 0}}, 0}},
				}},
				false,
			}},
			"effectiveNoRankDelta": bson.M{"$or": bson.A{
				bson.M{"$eq": bson.A{"$noRankDelta", true}},
				bson.M{"$cond": bson.A{
					bson.M{"$gt": bson.A{bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.total", 0}}, 0}}, 0}},
					bson.M{"$eq": bson.A{
						bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.noRankOn", 0}}, 0}},
						bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$_bc.total", 0}}, 0}},
					}},
					false,
				}},
			}},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"_rc":           0,
			"_bc":           0,
			"_startInstant": 0,
			"_endInstant":   0,
			"_isOngoing":    0,
			"_isUpcoming":   0,
			"nearDeltaMs":   0,
			"tieMs":         0,
		}}},
	)

	rows, err := aggregateDocuments(ctx, s.repository.tournaments, pipeline)
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		normalizeTournamentPublicFields(c, row)
	}
	return rows, nil
}

func (s *Service) Search(c *gin.Context) (gin.H, error) {
	ctx := c.Request.Context()
	q := strings.TrimSpace(c.Query("q"))
	status := strings.ToLower(strings.TrimSpace(c.Query("status")))
	limit := parseSearchLimit(c.Query("limit"))
	filter := bson.M{}

	if sportTypeRaw := strings.TrimSpace(c.Query("sportType")); sportTypeRaw != "" {
		if sportType, err := strconv.Atoi(sportTypeRaw); err == nil {
			filter["sportType"] = sportType
		}
	}

	if tokens := splitSearchTokens(q); len(tokens) > 0 {
		filter["$and"] = tokens
	}

	findOptions := options.Find().
		SetProjection(bson.M{
			"name":                 1,
			"code":                 1,
			"location":             1,
			"status":               1,
			"sportType":            1,
			"groupId":              1,
			"image":                1,
			"eventType":            1,
			"timezone":             1,
			"regOpenDate":          1,
			"registrationDeadline": 1,
			"startDate":            1,
			"endDate":              1,
			"startAt":              1,
			"endAt":                1,
			"scoringScope":         1,
			"locationGeo":          1,
			"createdAt":            1,
			"updatedAt":            1,
			"finishedAt":           1,
		}).
		SetSort(bson.D{{Key: "startAt", Value: 1}, {Key: "createdAt", Value: -1}}).
		SetLimit(int64(limit * 4))

	cursor, err := s.repository.tournaments.Find(ctx, filter, findOptions)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	rows := []bson.M{}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}

	now := time.Now()
	normalizedQuery := strings.ToLower(q)
	type scoredRow struct {
		row   bson.M
		score int
	}
	scored := make([]scoredRow, 0, len(rows))
	for _, row := range rows {
		row["status"] = computeRuntimeStatus(row, now)
		if status != "" && row["status"] != status {
			continue
		}
		score := scoreTournament(row, normalizedQuery)
		normalizeTournamentPublicFields(c, row)
		scored = append(scored, scoredRow{row: row, score: score})
	}

	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		iStart := timeValue(scored[i].row["startAt"])
		jStart := timeValue(scored[j].row["startAt"])
		if !iStart.Equal(jStart) {
			return iStart.Before(jStart)
		}
		return strings.ToLower(stringValue(scored[i].row["name"])) < strings.ToLower(stringValue(scored[j].row["name"]))
	})

	items := make([]bson.M, 0, min(limit, len(scored)))
	for _, item := range scored {
		items = append(items, item.row)
		if len(items) >= limit {
			break
		}
	}

	return gin.H{"items": items}, nil
}

func (s *Service) GetByID(c *gin.Context) (gin.H, error) {
	ctx := c.Request.Context()
	tournamentID, err := primitive.ObjectIDFromHex(strings.TrimSpace(c.Param("id")))
	if err != nil {
		return nil, ErrInvalidTournamentID
	}

	var tournament bson.M
	if err := s.repository.tournaments.FindOne(ctx, bson.M{"_id": tournamentID}).Decode(&tournament); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrTournamentNotFound
		}
		return nil, err
	}

	normalizeTournamentPublicFields(c, tournament)
	registrationsCount, checkedInCount, paidCount, err := s.registrationStats(ctx, tournamentID)
	if err != nil {
		return nil, err
	}

	managerRows, err := findDocuments(ctx, s.repository.tournamentManagers, bson.M{"tournament": tournamentID}, options.Find().SetProjection(bson.M{"user": 1, "role": 1}))
	if err != nil {
		return nil, err
	}

	allowedCourtClusters, err := s.loadAllowedCourtClusters(ctx, objectIDsFromAnySlice(tournament["allowedCourtClusterIds"]))
	if err != nil {
		return nil, err
	}

	teamConfig := mapValue(tournament["teamConfig"])
	factions := sliceValue(teamConfig["factions"])
	captainIDs := make([]primitive.ObjectID, 0, len(factions))
	for _, faction := range factions {
		captainID, ok := anyToObjectID(mapValue(faction)["captainUser"])
		if ok {
			captainIDs = append(captainIDs, captainID)
		}
	}
	captains, err := s.loadCaptains(ctx, captainIDs)
	if err != nil {
		return nil, err
	}

	normalizedFactions := make([]bson.M, 0, len(factions))
	for index, factionValue := range factions {
		faction := mapValue(factionValue)
		entry := bson.M{
			"_id":         stringValue(faction["_id"]),
			"name":        strings.TrimSpace(stringValue(faction["name"])),
			"order":       intValueDefault(faction["order"], index),
			"isActive":    boolValueDefault(faction["isActive"], true),
			"captainUser": nil,
		}
		if captainID, ok := anyToObjectID(faction["captainUser"]); ok {
			entry["captainUser"] = captains[captainID.Hex()]
		}
		normalizedFactions = append(normalizedFactions, entry)
	}

	managers := make([]bson.M, 0, len(managerRows))
	managerUserIDs := make([]string, 0, len(managerRows))
	for _, row := range managerRows {
		userID := objectIDHex(row["user"])
		managerUserIDs = append(managerUserIDs, userID)
		managers = append(managers, bson.M{
			"user": row["user"],
			"role": row["role"],
		})
	}

	now := time.Now()
	status := computeRuntimeStatus(tournament, now)
	tournament["status"] = status
	tournament["allowedCourtClusters"] = allowedCourtClusters
	tournament["tournamentMode"] = firstNonEmpty(stringValue(tournament["tournamentMode"]), "standard")
	tournament["teamConfig"] = bson.M{"factions": normalizedFactions}
	tournament["managers"] = managers
	tournament["stats"] = bson.M{
		"registrationsCount": registrationsCount,
		"checkedInCount":     checkedInCount,
		"paidCount":          paidCount,
	}

	isFreeRegistration := boolValueDefault(tournament["isFreeRegistration"], false)
	tournament["isFreeRegistration"] = isFreeRegistration
	registrationFee := intValueDefault(firstPresent(tournament["registrationFee"], tournament["fee"], tournament["entryFee"]), 0)
	if isFreeRegistration {
		registrationFee = 0
	}
	bankShortName := strings.TrimSpace(stringValue(firstPresent(tournament["bankShortName"], tournament["qrBank"], tournament["bankCode"], tournament["bank"])))
	bankAccountNumber := strings.TrimSpace(stringValue(firstPresent(tournament["bankAccountNumber"], tournament["qrAccount"], tournament["bankAccount"])))
	bankAccountName := strings.TrimSpace(stringValue(firstPresent(tournament["bankAccountName"], tournament["accountName"], tournament["paymentAccountName"], tournament["beneficiaryName"])))
	if isFreeRegistration {
		bankShortName = ""
		bankAccountNumber = ""
		bankAccountName = ""
	}
	tournament["bankShortName"] = bankShortName
	tournament["bankAccountNumber"] = bankAccountNumber
	tournament["bankAccountName"] = bankAccountName
	tournament["registrationFee"] = registrationFee
	tournament["qrBank"] = bankShortName
	tournament["qrAccount"] = bankAccountNumber
	tournament["fee"] = registrationFee
	tournament["entryFee"] = registrationFee

	meID := currentUserID(c)
	amOwner := meID != "" && objectIDHex(tournament["createdBy"]) == meID
	amManager := amOwner
	if !amManager && meID != "" {
		for _, managerUserID := range managerUserIDs {
			if managerUserID == meID {
				amManager = true
				break
			}
		}
	}
	tournament["amOwner"] = amOwner
	tournament["amManager"] = amManager

	return gin.H(tournament), nil
}

func (s *Service) registrationStats(ctx context.Context, tournamentID primitive.ObjectID) (int64, int64, int64, error) {
	registrationsCount, err := s.repository.registrations.CountDocuments(ctx, bson.M{"tournament": tournamentID})
	if err != nil {
		return 0, 0, 0, err
	}
	checkedInCount, err := s.repository.registrations.CountDocuments(ctx, bson.M{"tournament": tournamentID, "checkinAt": bson.M{"$ne": nil}})
	if err != nil {
		return 0, 0, 0, err
	}
	paidCount, err := s.repository.registrations.CountDocuments(ctx, bson.M{"tournament": tournamentID, "payment.status": "Paid"})
	if err != nil {
		return 0, 0, 0, err
	}
	return registrationsCount, checkedInCount, paidCount, nil
}

func (s *Service) loadAllowedCourtClusters(ctx context.Context, ids []primitive.ObjectID) ([]bson.M, error) {
	if len(ids) == 0 {
		return []bson.M{}, nil
	}
	rows, err := findDocuments(ctx, s.repository.courtClusters, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{
		"name":      1,
		"slug":      1,
		"venueName": 1,
		"isActive":  1,
		"order":     1,
	}))
	if err != nil {
		return nil, err
	}
	normalized := make([]bson.M, 0, len(rows))
	for _, row := range rows {
		normalized = append(normalized, bson.M{
			"_id":       objectIDHex(row["_id"]),
			"name":      strings.TrimSpace(stringValue(row["name"])),
			"slug":      strings.TrimSpace(stringValue(row["slug"])),
			"venueName": strings.TrimSpace(stringValue(row["venueName"])),
			"isActive":  boolValueDefault(row["isActive"], true),
			"order":     intValueDefault(row["order"], 0),
		})
	}
	sort.SliceStable(normalized, func(i, j int) bool {
		return intValueDefault(normalized[i]["order"], 0) < intValueDefault(normalized[j]["order"], 0)
	})
	return normalized, nil
}

func (s *Service) loadCaptains(ctx context.Context, ids []primitive.ObjectID) (map[string]bson.M, error) {
	if len(ids) == 0 {
		return map[string]bson.M{}, nil
	}
	rows, err := findDocuments(ctx, s.repository.users, bson.M{"_id": bson.M{"$in": ids}}, options.Find().SetProjection(bson.M{
		"name":     1,
		"nickname": 1,
		"avatar":   1,
		"phone":    1,
	}))
	if err != nil {
		return nil, err
	}
	result := make(map[string]bson.M, len(rows))
	for _, row := range rows {
		result[objectIDHex(row["_id"])] = bson.M{
			"_id":      objectIDHex(row["_id"]),
			"name":     strings.TrimSpace(stringValue(row["name"])),
			"nickname": strings.TrimSpace(stringValue(row["nickname"])),
			"avatar":   strings.TrimSpace(stringValue(row["avatar"])),
			"phone":    strings.TrimSpace(stringValue(row["phone"])),
		}
	}
	return result, nil
}

func aggregateDocuments(ctx context.Context, collection *mongo.Collection, pipeline mongo.Pipeline) ([]bson.M, error) {
	cursor, err := collection.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	rows := []bson.M{}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func findDocuments(ctx context.Context, collection *mongo.Collection, filter interface{}, opts ...*options.FindOptions) ([]bson.M, error) {
	cursor, err := collection.Find(ctx, filter, opts...)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	rows := []bson.M{}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func normalizeTournamentPublicFields(c *gin.Context, row bson.M) {
	image := strings.TrimSpace(stringValue(row["image"]))
	if image != "" {
		row["image"] = httpx.ToPublicURL(c, image, true)
	}
	overlay := mapValue(row["overlay"])
	if len(overlay) > 0 {
		if logoURL := strings.TrimSpace(stringValue(overlay["logoUrl"])); logoURL != "" {
			overlay["logoUrl"] = httpx.ToPublicURL(c, logoURL, false)
		}
		row["overlay"] = overlay
	}
}

func buildKeywordMatch(rawKeyword string) bson.M {
	tokens := strings.Fields(rawKeyword)
	if len(tokens) == 0 {
		return bson.M{}
	}

	tokenConditions := make([]bson.M, 0, len(tokens))
	for _, token := range tokens {
		pattern := regexp.QuoteMeta(token)
		tokenConditions = append(tokenConditions, bson.M{
			"$or": bson.A{
				bson.M{"name": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"slug": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"code": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"location": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"venueName": bson.M{"$regex": pattern, "$options": "i"}},
			},
		})
	}

	orExpr := []bson.M{}
	if len(tokenConditions) > 0 {
		orExpr = append(orExpr, bson.M{"$and": tokenConditions})
	}
	if objectID, err := primitive.ObjectIDFromHex(rawKeyword); err == nil {
		orExpr = append(orExpr, bson.M{"_id": objectID})
	}
	if len(orExpr) == 1 {
		return orExpr[0]
	}
	return bson.M{"$or": orExpr}
}

func splitSearchTokens(q string) []bson.M {
	tokens := strings.Fields(q)
	conditions := make([]bson.M, 0, len(tokens))
	for _, token := range tokens {
		pattern := regexp.QuoteMeta(token)
		conditions = append(conditions, bson.M{
			"$or": bson.A{
				bson.M{"name": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"code": bson.M{"$regex": pattern, "$options": "i"}},
				bson.M{"location": bson.M{"$regex": pattern, "$options": "i"}},
			},
		})
	}
	return conditions
}

func parseSort(raw string) bson.D {
	sortSpec := bson.D{}
	for _, token := range strings.Split(strings.TrimSpace(raw), ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		direction := 1
		field := token
		if strings.HasPrefix(field, "-") {
			direction = -1
			field = strings.TrimPrefix(field, "-")
		}
		sortSpec = append(sortSpec, bson.E{Key: field, Value: direction})
	}
	return sortSpec
}

func parseOptionalLimit(raw string) int64 {
	if strings.TrimSpace(raw) == "" {
		return 0
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < 0 {
		return 0
	}
	return int64(value)
}

func parseSearchLimit(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return 20
	}
	if value > 50 {
		return 50
	}
	return value
}

func computeRuntimeStatus(row bson.M, now time.Time) string {
	if finishedAt := timeValue(row["finishedAt"]); !finishedAt.IsZero() {
		return "finished"
	}
	startInstant := firstTimeValue(row["startAt"], row["startDate"])
	endInstant := firstTimeValue(row["endAt"], row["endDate"])
	if !startInstant.IsZero() && now.Before(startInstant) {
		return "upcoming"
	}
	if !endInstant.IsZero() && now.After(endInstant) {
		return "finished"
	}
	return "ongoing"
}

func scoreTournament(row bson.M, normalizedQuery string) int {
	if normalizedQuery == "" {
		return 0
	}
	code := strings.ToLower(stringValue(row["code"]))
	name := strings.ToLower(stringValue(row["name"]))
	location := strings.ToLower(stringValue(row["location"]))
	score := 0
	switch {
	case code == normalizedQuery:
		score += 200
	case name == normalizedQuery:
		score += 160
	}
	if strings.HasPrefix(code, normalizedQuery) {
		score += 100
	}
	if strings.HasPrefix(name, normalizedQuery) {
		score += 80
	}
	if strings.HasPrefix(location, normalizedQuery) {
		score += 40
	}
	if strings.Contains(code, normalizedQuery) {
		score += 25
	}
	if strings.Contains(name, normalizedQuery) {
		score += 20
	}
	if strings.Contains(location, normalizedQuery) {
		score += 10
	}
	return score
}

func timeValue(value any) time.Time {
	switch typed := value.(type) {
	case primitive.DateTime:
		return typed.Time()
	case time.Time:
		return typed
	default:
		return time.Time{}
	}
}

func firstTimeValue(values ...any) time.Time {
	for _, value := range values {
		if parsed := timeValue(value); !parsed.IsZero() {
			return parsed
		}
	}
	return time.Time{}
}

func objectIDsFromAnySlice(value any) []primitive.ObjectID {
	items := sliceValue(value)
	result := make([]primitive.ObjectID, 0, len(items))
	for _, item := range items {
		if objectID, ok := anyToObjectID(item); ok {
			result = append(result, objectID)
		}
	}
	return result
}

func anyToObjectID(value any) (primitive.ObjectID, bool) {
	switch typed := value.(type) {
	case primitive.ObjectID:
		return typed, true
	case string:
		objectID, err := primitive.ObjectIDFromHex(strings.TrimSpace(typed))
		return objectID, err == nil
	case bson.M:
		return anyToObjectID(typed["_id"])
	case map[string]any:
		return anyToObjectID(typed["_id"])
	default:
		return primitive.NilObjectID, false
	}
}

func objectIDHex(value any) string {
	if objectID, ok := anyToObjectID(value); ok {
		return objectID.Hex()
	}
	return ""
}

func mapValue(value any) bson.M {
	switch typed := value.(type) {
	case bson.M:
		return typed
	case map[string]any:
		return bson.M(typed)
	default:
		return bson.M{}
	}
}

func sliceValue(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case bson.A:
		return []any(typed)
	case []bson.M:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	case []string:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	case []primitive.ObjectID:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return []any{}
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case primitive.ObjectID:
		return typed.Hex()
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func intValueDefault(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case float32:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return fallback
		}
		return parsed
	default:
		return fallback
	}
}

func boolValueDefault(value any, fallback bool) bool {
	typed, ok := value.(bool)
	if !ok {
		return fallback
	}
	return typed
}

func firstPresent(values ...any) any {
	for _, value := range values {
		switch typed := value.(type) {
		case nil:
			continue
		case string:
			if strings.TrimSpace(typed) == "" {
				continue
			}
		}
		return value
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
