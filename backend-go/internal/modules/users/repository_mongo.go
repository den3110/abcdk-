package users

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

type MongoRepository struct {
	db            *mongo.Database
	users         *mongo.Collection
	rankings      *mongo.Collection
	userLogins    *mongo.Collection
	registrations *mongo.Collection
	assessments   *mongo.Collection
	tournaments   *mongo.Collection
	matches       *mongo.Collection
	scoreHistory  *mongo.Collection
	now           func() time.Time
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		db:            db,
		users:         db.Collection("users"),
		rankings:      db.Collection("rankings"),
		userLogins:    db.Collection("userlogins"),
		registrations: db.Collection("registrations"),
		assessments:   db.Collection("assessments"),
		tournaments:   db.Collection("tournaments"),
		matches:       db.Collection("matches"),
		scoreHistory:  db.Collection("scorehistories"),
		now:           time.Now,
	}
}

func (r *MongoRepository) FindByID(ctx context.Context, id primitive.ObjectID) (*UserDocument, error) {
	var user UserDocument
	err := r.users.FindOne(ctx, bson.M{"_id": id}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) FindForWebLogin(ctx context.Context, lookup LoginLookup) (*UserDocument, error) {
	query := bson.M{}
	switch {
	case strings.TrimSpace(lookup.Identifier) != "":
		identifier := strings.TrimSpace(lookup.Identifier)
		if strings.Contains(identifier, "@") {
			query["email"] = normalizeEmail(identifier)
		} else {
			query["phone"] = normalizePhone(identifier)
		}
	case strings.TrimSpace(lookup.Email) != "":
		query["email"] = normalizeEmail(lookup.Email)
	default:
		query["phone"] = normalizePhone(lookup.Phone)
	}

	var user UserDocument
	err := r.users.FindOne(ctx, query).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) FindDeletedCandidate(ctx context.Context, phone, nickname string) (*UserDocument, error) {
	filters := []bson.M{}
	if phone != "" && nickname != "" {
		filters = append(filters, bson.M{"isDeleted": true, "phone": phone, "nickname": nickname})
	}
	if phone != "" {
		filters = append(filters, bson.M{"isDeleted": true, "phone": phone})
	}
	if nickname != "" {
		filters = append(filters, bson.M{"isDeleted": true, "nickname": nickname})
	}

	for _, filter := range filters {
		var user UserDocument
		err := r.users.FindOne(ctx, filter).Decode(&user)
		if errors.Is(err, mongo.ErrNoDocuments) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return &user, nil
	}

	return nil, nil
}

func (r *MongoRepository) FindDuplicateActive(ctx context.Context, email, phone, nickname string) (*UserDocument, error) {
	ors := make([]bson.M, 0, 3)
	if email != "" {
		ors = append(ors, bson.M{"email": email, "isDeleted": bson.M{"$ne": true}})
	}
	if phone != "" {
		ors = append(ors, bson.M{"phone": phone, "isDeleted": bson.M{"$ne": true}})
	}
	if nickname != "" {
		ors = append(ors, bson.M{"nickname": nickname, "isDeleted": bson.M{"$ne": true}})
	}
	if len(ors) == 0 {
		return nil, nil
	}

	var user UserDocument
	err := r.users.FindOne(ctx, bson.M{"$or": ors}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) FindActiveByCCCD(ctx context.Context, cccd string) (*UserDocument, error) {
	if strings.TrimSpace(cccd) == "" {
		return nil, nil
	}

	var user UserDocument
	err := r.users.FindOne(ctx, bson.M{"cccd": cccd, "isDeleted": bson.M{"$ne": true}}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) RestoreUser(ctx context.Context, id primitive.ObjectID) (*UserDocument, error) {
	now := r.now().UTC()
	update := bson.M{
		"$set": bson.M{
			"isDeleted": false,
			"updatedAt": now,
		},
		"$unset": bson.M{
			"deletedAt":      "",
			"deletionReason": "",
		},
	}

	opts := options.FindOneAndUpdate().
		SetReturnDocument(options.After)

	var user UserDocument
	err := r.users.FindOneAndUpdate(ctx, bson.M{"_id": id}, update, opts).Decode(&user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) CreateUserWithRanking(ctx context.Context, params CreateUserParams) (*UserDocument, error) {
	session, err := r.db.Client().StartSession()
	if err != nil {
		return nil, err
	}
	defer session.EndSession(ctx)

	now := r.now().UTC()
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(params.Password), 10)
	if err != nil {
		return nil, err
	}

	user := &UserDocument{
		ID:         primitive.NewObjectID(),
		Name:       params.Name,
		Nickname:   params.Nickname,
		Phone:      params.Phone,
		Email:      params.Email,
		Password:   string(hashedPassword),
		Avatar:     params.Avatar,
		Province:   params.Province,
		Gender:     firstNonEmpty(params.Gender, "unspecified"),
		Verified:   "pending",
		CCCDStatus: "unverified",
		CCCD:       params.CCCD,
		Role:       "user",
		DOB:        params.DOB,
		CreatedAt:  now,
		UpdatedAt:  now,
		CCCDImages: params.CCCDImages,
		SignupMeta: params.SignupMeta,
	}

	if user.CCCD != "" && (user.CCCDImages.Front != "" || user.CCCDImages.Back != "") {
		user.CCCDStatus = "pending"
	}

	callback := func(sc mongo.SessionContext) (any, error) {
		if _, err := r.users.InsertOne(sc, user); err != nil {
			return nil, err
		}
		if _, err := r.rankings.UpdateOne(
			sc,
			bson.M{"user": user.ID},
			bson.M{"$setOnInsert": bson.M{
				"user":        user.ID,
				"single":      0,
				"double":      0,
				"mix":         0,
				"points":      0,
				"lastUpdated": now,
			}},
			options.Update().SetUpsert(true),
		); err != nil {
			return nil, err
		}
		return nil, nil
	}

	if _, err := session.WithTransaction(ctx, callback); err != nil {
		return nil, err
	}

	return user, nil
}

func (r *MongoRepository) EnsureRanking(ctx context.Context, userID primitive.ObjectID) error {
	_, err := r.rankings.UpdateOne(
		ctx,
		bson.M{"user": userID},
		bson.M{"$setOnInsert": bson.M{
			"user":        userID,
			"single":      0,
			"double":      0,
			"mix":         0,
			"points":      0,
			"lastUpdated": r.now().UTC(),
		}},
		options.Update().SetUpsert(true),
	)
	return err
}

func (r *MongoRepository) UpgradePasswordHash(ctx context.Context, userID primitive.ObjectID, expectedOldPassword, nextHash string) error {
	_, err := r.users.UpdateOne(
		ctx,
		bson.M{"_id": userID, "password": expectedOldPassword},
		bson.M{"$set": bson.M{"password": nextHash, "updatedAt": r.now().UTC()}},
	)
	return err
}

func (r *MongoRepository) RecordLogin(ctx context.Context, event LoginEvent) error {
	now := event.At
	if now.IsZero() {
		now = r.now().UTC()
	}

	update := bson.M{
		"$push": bson.M{
			"loginHistory": bson.M{
				"$each": []bson.M{{
					"at":        now,
					"ip":        event.IP,
					"userAgent": event.UserAgent,
					"method":    firstNonEmpty(event.Method, "password"),
					"success":   event.Success,
				}},
				"$position": 0,
				"$slice":    50,
			},
		},
	}
	if event.Success {
		update["$set"] = bson.M{"lastLoginAt": now}
	}

	_, err := r.userLogins.UpdateOne(
		ctx,
		bson.M{"user": event.UserID},
		update,
		options.Update().SetUpsert(true),
	)
	return err
}

func (r *MongoRepository) HasParticipated(ctx context.Context, userID primitive.ObjectID) (bool, error) {
	err := r.registrations.FindOne(ctx, bson.M{
		"$or": []bson.M{
			{"player1.user": userID},
			{"player2.user": userID},
		},
	}).Err()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return false, nil
	}
	return err == nil, err
}

func (r *MongoRepository) HasStaffAssessment(ctx context.Context, userID primitive.ObjectID) (bool, error) {
	err := r.assessments.FindOne(ctx, bson.M{
		"user": userID,
		"$or": []bson.M{
			{"meta.scoreBy": bson.M{"$in": []string{"admin", "mod", "moderator"}}},
			{"meta.selfScored": false},
		},
	}).Err()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return false, nil
	}
	return err == nil, err
}

func (r *MongoRepository) LoadRanking(ctx context.Context, userID primitive.ObjectID) (*RankingDocument, error) {
	var ranking RankingDocument
	err := r.rankings.FindOne(ctx, bson.M{"user": userID}).Decode(&ranking)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ranking, nil
}

func (r *MongoRepository) ComputeRankNo(ctx context.Context, userID primitive.ObjectID) (*int, error) {
	cursor, err := r.rankings.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$setWindowFields", Value: bson.M{
			"sortBy": bson.D{
				{Key: "colorRank", Value: 1},
				{Key: "double", Value: -1},
				{Key: "single", Value: -1},
				{Key: "points", Value: -1},
				{Key: "updatedAt", Value: -1},
				{Key: "_id", Value: 1},
			},
			"output": bson.M{
				"rankNo": bson.M{"$rank": bson.M{}},
			},
		}}},
		{{Key: "$match", Value: bson.M{"user": userID}}},
		{{Key: "$project", Value: bson.M{"_id": 0, "rankNo": 1}}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		RankNo int `bson:"rankNo"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	rankNo := rows[0].RankNo
	return &rankNo, nil
}

func (r *MongoRepository) CountFinishedTournamentParticipations(ctx context.Context, userID primitive.ObjectID) (int64, error) {
	cursor, err := r.registrations.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"$expr": bson.M{
				"$or": bson.A{
					bson.M{"$eq": bson.A{"$player1.user", userID}},
					bson.M{"$eq": bson.A{"$player2.user", userID}},
				},
			},
		}}},
		{{Key: "$lookup", Value: bson.M{
			"from":         "tournaments",
			"localField":   "tournament",
			"foreignField": "_id",
			"as":           "tour",
			"pipeline": mongo.Pipeline{
				{{Key: "$project", Value: bson.M{"_id": 1, "status": 1, "finishedAt": 1, "endAt": 1}}},
			},
		}}},
		{{Key: "$addFields", Value: bson.M{
			"status":     bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$tour.status", 0}}, ""}},
			"finishedAt": bson.M{"$arrayElemAt": bson.A{"$tour.finishedAt", 0}},
			"rawEndAt":   bson.M{"$arrayElemAt": bson.A{"$tour.endAt", 0}},
		}}},
		{{Key: "$addFields", Value: bson.M{
			"endAtDate": bson.M{"$convert": bson.M{
				"input":   "$rawEndAt",
				"to":      "date",
				"onError": nil,
				"onNull":  nil,
			}},
			"tourFinished": bson.M{"$or": bson.A{
				bson.M{"$eq": bson.A{"$status", "finished"}},
				bson.M{"$ne": bson.A{"$finishedAt", nil}},
				bson.M{"$and": bson.A{
					bson.M{"$ne": bson.A{"$endAtDate", nil}},
					bson.M{"$lt": bson.A{"$endAtDate", r.now()}},
				}},
			}},
		}}},
		{{Key: "$match", Value: bson.M{"tourFinished": true}}},
		{{Key: "$group", Value: bson.M{"_id": "$tournament"}}},
		{{Key: "$count", Value: "n"}},
	})
	if err != nil {
		return 0, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		N int64 `bson:"n"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].N, nil
}

func (r *MongoRepository) FindDuplicateForProfile(ctx context.Context, userID primitive.ObjectID, email, phone, nickname, cccd string) (*UserDocument, error) {
	ors := make([]bson.M, 0, 4)
	if email != "" {
		ors = append(ors, bson.M{"email": email})
	}
	if phone != "" {
		ors = append(ors, bson.M{"phone": phone})
	}
	if nickname != "" {
		ors = append(ors, bson.M{"nickname": nickname})
	}
	if cccd != "" {
		ors = append(ors, bson.M{"cccd": cccd})
	}
	if len(ors) == 0 {
		return nil, nil
	}

	var user UserDocument
	err := r.users.FindOne(ctx, bson.M{"$or": ors, "_id": bson.M{"$ne": userID}}).Decode(&user)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) UpdateProfile(ctx context.Context, userID primitive.ObjectID, update bson.M) (*UserDocument, error) {
	if len(update) == 0 {
		return r.FindByID(ctx, userID)
	}

	opts := options.FindOneAndUpdate().
		SetReturnDocument(options.After)

	var user UserDocument
	err := r.users.FindOneAndUpdate(ctx, bson.M{"_id": userID}, bson.M{"$set": update}, opts).Decode(&user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *MongoRepository) SyncRegistrationProfileSnapshot(ctx context.Context, user *UserDocument) error {
	if user == nil {
		return nil
	}

	snapshot := bson.M{
		"fullName": strings.TrimSpace(firstNonEmpty(user.FullName, user.Name, user.Nickname)),
		"nickName": strings.TrimSpace(user.Nickname),
		"avatar":   strings.TrimSpace(user.Avatar),
	}

	if _, err := r.registrations.UpdateMany(ctx, bson.M{"player1.user": user.ID}, bson.M{"$set": bson.M{
		"player1.fullName": snapshot["fullName"],
		"player1.nickName": snapshot["nickName"],
		"player1.avatar":   snapshot["avatar"],
	}}); err != nil {
		return err
	}

	if _, err := r.registrations.UpdateMany(ctx, bson.M{"player2.user": user.ID}, bson.M{"$set": bson.M{
		"player2.fullName": snapshot["fullName"],
		"player2.nickName": snapshot["nickName"],
		"player2.avatar":   snapshot["avatar"],
	}}); err != nil {
		return err
	}

	return nil
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

	remaining := make([]primitive.ObjectID, 0, len(userIDs))
	for _, userID := range userIDs {
		if _, ok := scoreMap[userID.Hex()]; !ok {
			remaining = append(remaining, userID)
		}
	}
	if len(remaining) == 0 {
		return scoreMap, nil
	}

	historyCursor, err := r.scoreHistory.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"user": bson.M{"$in": remaining}}}},
		{{Key: "$sort", Value: bson.D{{Key: "user", Value: 1}, {Key: "scoredAt", Value: -1}}}},
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

func (r *MongoRepository) FindUsersByPhoneVariants(ctx context.Context, phones []string, limit int64) ([]UserDocument, error) {
	cursor, err := r.users.Find(ctx, bson.M{"phone": bson.M{"$in": phones}}, options.Find().
		SetProjection(bson.M{"name": 1, "nickname": 1, "phone": 1, "avatar": 1, "province": 1}).
		SetLimit(limit))
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

func (r *MongoRepository) FindUsersByPrefixQuery(ctx context.Context, rawQuery string, limit int64) ([]UserDocument, error) {
	regexPrefix := primitive.Regex{Pattern: "^" + regexp.QuoteMeta(rawQuery), Options: "i"}
	filter := bson.M{"$or": bson.A{
		bson.M{"nickname": rawQuery},
		bson.M{"name": rawQuery},
		bson.M{"province": rawQuery},
		bson.M{"nickname": regexPrefix},
		bson.M{"name": regexPrefix},
		bson.M{"province": regexPrefix},
	}}
	opts := options.Find().
		SetProjection(bson.M{"name": 1, "nickname": 1, "phone": 1, "avatar": 1, "province": 1}).
		SetLimit(limit).
		SetCollation(&options.Collation{Locale: "vi", Strength: 1})

	cursor, err := r.users.Find(ctx, filter, opts)
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

func (r *MongoRepository) FindUsersByTokenQuery(ctx context.Context, tokens []string, limit int64) ([]UserDocument, error) {
	andConds := make([]bson.M, 0, len(tokens))
	for _, token := range tokens {
		andConds = append(andConds, bson.M{"$or": bson.A{
			bson.M{"nickname": primitive.Regex{Pattern: regexp.QuoteMeta(token), Options: "i"}},
			bson.M{"name": primitive.Regex{Pattern: regexp.QuoteMeta(token), Options: "i"}},
			bson.M{"province": primitive.Regex{Pattern: "^" + regexp.QuoteMeta(token), Options: "i"}},
		}})
	}

	cursor, err := r.users.Find(ctx, bson.M{"$and": andConds}, options.Find().
		SetProjection(bson.M{"name": 1, "nickname": 1, "phone": 1, "avatar": 1, "province": 1}).
		SetLimit(limit))
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

func (r *MongoRepository) ComputeGroupCompletionStatus(ctx context.Context, tournamentID primitive.ObjectID) (map[string]bool, error) {
	cursor, err := r.matches.Find(ctx, bson.M{"tournament": tournamentID, "format": "group"}, options.Find().SetProjection(bson.M{
		"status":     1,
		"stageIndex": 1,
		"pool":       1,
		"groupCode":  1,
	}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var rows []bson.M
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}

	result := make(map[string]bool)
	for _, row := range rows {
		stage := intValue(row["stageIndex"], 1)
		poolName := strings.TrimSpace(stringField(mapValue(row["pool"]), "name"))
		rawGroupCode := strings.TrimSpace(firstNonEmpty(poolName, stringField(row, "groupCode")))
		if rawGroupCode == "" {
			continue
		}
		groupCode := normalizeGroupCode(rawGroupCode)
		key := strconv.Itoa(stage) + "_" + groupCode
		if _, exists := result[key]; !exists {
			result[key] = true
		}
		if stringField(row, "status") != "finished" {
			result[key] = false
		}
	}

	return result, nil
}

func (r *MongoRepository) ListMyTournaments(ctx context.Context, userID primitive.ObjectID, params ListMyTournamentsParams) ([]bson.M, int64, error) {
	statusFilter := bson.A{}
	for _, status := range params.Status {
		if trimmed := strings.TrimSpace(status); trimmed != "" {
			statusFilter = append(statusFilter, trimmed)
		}
	}

	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{
			"$or": bson.A{
				bson.M{"player1.user": userID},
				bson.M{"player2.user": userID},
			},
		}}},
		{{Key: "$group", Value: bson.M{
			"_id":               "$tournament",
			"myRegistrationIds": bson.M{"$addToSet": "$_id"},
			"firstJoinedAt":     bson.M{"$min": "$createdAt"},
			"paidAny":           bson.M{"$max": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$payment.status", "Paid"}}, 1, 0}}},
			"checkedAny":        bson.M{"$max": bson.M{"$cond": bson.A{bson.M{"$ifNull": bson.A{"$checkinAt", false}}, 1, 0}}},
		}}},
		{{Key: "$addFields", Value: bson.M{"myRegistrationIds": bson.M{"$ifNull": bson.A{"$myRegistrationIds", bson.A{}}}}}},
		{{Key: "$lookup", Value: bson.M{
			"from":         "tournaments",
			"localField":   "_id",
			"foreignField": "_id",
			"as":           "tournament",
		}}},
		{{Key: "$unwind", Value: "$tournament"}},
	}

	if len(statusFilter) > 0 {
		pipeline = append(pipeline, bson.D{{Key: "$match", Value: bson.M{"tournament.status": bson.M{"$in": statusFilter}}}})
	}

	if params.WithMatches {
		pipeline = append(pipeline, bson.D{{Key: "$lookup", Value: bson.M{
			"from": "matches",
			"let":  bson.M{"tourId": "$_id", "regIds": bson.M{"$ifNull": bson.A{"$myRegistrationIds", bson.A{}}}},
			"pipeline": mongo.Pipeline{
				{{Key: "$match", Value: bson.M{"$expr": bson.M{"$and": bson.A{
					bson.M{"$eq": bson.A{"$tournament", "$$tourId"}},
					bson.M{"$or": bson.A{
						bson.M{"$in": bson.A{"$pairA", "$$regIds"}},
						bson.M{"$in": bson.A{"$pairB", "$$regIds"}},
					}},
				}}}}},
				{{Key: "$sort", Value: bson.D{{Key: "stageIndex", Value: 1}, {Key: "round", Value: 1}, {Key: "order", Value: 1}, {Key: "createdAt", Value: 1}}}},
				{{Key: "$limit", Value: params.MatchLimit}},
				{{Key: "$lookup", Value: bson.M{"from": "registrations", "localField": "pairA", "foreignField": "_id", "as": "pairAReg"}}},
				{{Key: "$unwind", Value: bson.M{"path": "$pairAReg", "preserveNullAndEmptyArrays": true}}},
				{{Key: "$lookup", Value: bson.M{"from": "registrations", "localField": "pairB", "foreignField": "_id", "as": "pairBReg"}}},
				{{Key: "$unwind", Value: bson.M{"path": "$pairBReg", "preserveNullAndEmptyArrays": true}}},
				{{Key: "$project", Value: bson.M{
					"_id":         1,
					"status":      1,
					"winner":      1,
					"round":       1,
					"rrRound":     1,
					"swissRound":  1,
					"phase":       1,
					"branch":      1,
					"format":      1,
					"scheduledAt": 1,
					"courtName":   "$courtLabel",
					"seedA":       1,
					"seedB":       1,
					"stageIndex":  1,
					"pool":        1,
					"groupCode":   1,
					"sets": bson.M{"$map": bson.M{
						"input": bson.M{"$ifNull": bson.A{"$gameScores", bson.A{}}},
						"as":    "s",
						"in": bson.M{
							"a": bson.M{"$ifNull": bson.A{"$$s.a", 0}},
							"b": bson.M{"$ifNull": bson.A{"$$s.b", 0}},
						},
					}},
					"teamA": bson.M{"players": bson.M{"$filter": bson.M{
						"input": bson.A{
							bson.M{"user": "$pairAReg.player1.user", "fullName": "$pairAReg.player1.fullName", "nickName": "$pairAReg.player1.nickName", "avatar": "$pairAReg.player1.avatar", "phone": "$pairAReg.player1.phone", "score": "$pairAReg.player1.score"},
							bson.M{"user": "$pairAReg.player2.user", "fullName": "$pairAReg.player2.fullName", "nickName": "$pairAReg.player2.nickName", "avatar": "$pairAReg.player2.avatar", "phone": "$pairAReg.player2.phone", "score": "$pairAReg.player2.score"},
						},
						"as":   "p",
						"cond": bson.M{"$ne": bson.A{"$$p.user", nil}},
					}}},
					"teamB": bson.M{"players": bson.M{"$filter": bson.M{
						"input": bson.A{
							bson.M{"user": "$pairBReg.player1.user", "fullName": "$pairBReg.player1.fullName", "nickName": "$pairBReg.player1.nickName", "avatar": "$pairBReg.player1.avatar", "phone": "$pairBReg.player1.phone", "score": "$pairBReg.player1.score"},
							bson.M{"user": "$pairBReg.player2.user", "fullName": "$pairBReg.player2.fullName", "nickName": "$pairBReg.player2.nickName", "avatar": "$pairBReg.player2.avatar", "phone": "$pairBReg.player2.phone", "score": "$pairBReg.player2.score"},
						},
						"as":   "p",
						"cond": bson.M{"$ne": bson.A{"$$p.user", nil}},
					}}},
				}}},
				{{Key: "$project", Value: bson.M{
					"_id":         1,
					"status":      1,
					"winner":      1,
					"round":       1,
					"rrRound":     1,
					"swissRound":  1,
					"phase":       1,
					"branch":      1,
					"format":      1,
					"scheduledAt": 1,
					"courtName":   1,
					"sets":        1,
					"seedA":       1,
					"seedB":       1,
					"stageIndex":  1,
					"pool":        1,
					"groupCode":   1,
					"teams":       bson.A{"$teamA", "$teamB"},
				}}},
			},
			"as": "matches",
		}}})
	}

	pipeline = append(pipeline,
		bson.D{{Key: "$sort", Value: bson.D{{Key: "tournament.startAt", Value: -1}, {Key: "tournament.createdAt", Value: -1}}}},
		bson.D{{Key: "$facet", Value: bson.M{
			"total": mongo.Pipeline{
				{{Key: "$count", Value: "count"}},
			},
			"items": mongo.Pipeline{
				{{Key: "$skip", Value: (params.Page - 1) * params.Limit}},
				{{Key: "$limit", Value: params.Limit}},
			},
		}}},
		bson.D{{Key: "$project", Value: bson.M{
			"total": bson.M{"$ifNull": bson.A{bson.M{"$arrayElemAt": bson.A{"$total.count", 0}}, 0}},
			"items": 1,
		}}},
	)

	cursor, err := r.registrations.Aggregate(ctx, pipeline)
	if err != nil {
		return nil, 0, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		Total int64    `bson:"total"`
		Items []bson.M `bson:"items"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, 0, err
	}
	if len(rows) == 0 {
		return []bson.M{}, 0, nil
	}
	return rows[0].Items, rows[0].Total, nil
}

func normalizeGroupCode(code string) string {
	s := strings.ToUpper(strings.TrimSpace(code))
	if s == "" {
		return ""
	}
	if regexp.MustCompile(`^\d+$`).MatchString(s) {
		return s
	}
	if regexp.MustCompile(`^[A-Z]$`).MatchString(s) {
		return strconv.Itoa(int(s[0]) - 64)
	}
	return s
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

func stringField(value any, key string) string {
	switch typed := value.(type) {
	case bson.M:
		return strings.TrimSpace(stringFromAny(typed[key]))
	case map[string]any:
		return strings.TrimSpace(stringFromAny(typed[key]))
	default:
		return strings.TrimSpace(stringFromAny(value))
	}
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case primitive.ObjectID:
		return typed.Hex()
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func intValue(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return fallback
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
