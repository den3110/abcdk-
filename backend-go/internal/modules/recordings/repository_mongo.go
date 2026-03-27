package recordings

import (
	"context"
	"errors"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type MongoRepository struct {
	recordings *mongo.Collection
	chunks     *mongo.Collection
	now        func() time.Time
}

func NewMongoRepository(database *mongo.Database) *MongoRepository {
	return &MongoRepository{
		recordings: database.Collection("liverecordings"),
		chunks:     database.Collection("liverecordingchunks"),
		now:        time.Now,
	}
}

func (r *MongoRepository) EnsureRecording(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error) {
	now := r.now()
	update := bson.M{
		"$set": bson.M{
			"updatedAt": now,
		},
		"$setOnInsert": bson.M{
			"match":         matchID,
			"totalChunks":   0,
			"totalSizeMB":   0,
			"status":        "recording",
			"hasFinalChunk": false,
			"meta":          bson.M{},
			"createdAt":     now,
		},
	}

	findOptions := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var recording RecordingDocument
	if err := r.recordings.FindOneAndUpdate(ctx, bson.M{"match": matchID}, update, findOptions).Decode(&recording); err != nil {
		return nil, err
	}

	return &recording, nil
}

func (r *MongoRepository) UpsertChunk(ctx context.Context, params UpsertChunkParams) (*ChunkDocument, error) {
	now := r.now()
	update := bson.M{
		"$set": bson.M{
			"recording":     params.RecordingID,
			"match":         params.MatchID,
			"chunkIndex":    params.ChunkIndex,
			"isFinal":       params.IsFinal,
			"filePath":      params.FilePath,
			"fileSizeBytes": params.FileSizeBytes,
			"fileSizeMB":    params.FileSizeMB,
			"status":        "uploaded",
			"updatedAt":     now,
		},
		"$setOnInsert": bson.M{
			"createdAt": now,
		},
	}

	findOptions := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var chunk ChunkDocument
	if err := r.chunks.FindOneAndUpdate(
		ctx,
		bson.M{"match": params.MatchID, "chunkIndex": params.ChunkIndex},
		update,
		findOptions,
	).Decode(&chunk); err != nil {
		return nil, err
	}

	return &chunk, nil
}

func (r *MongoRepository) AggregateChunks(ctx context.Context, recordingID primitive.ObjectID) (ChunkAggregate, error) {
	cursor, err := r.chunks.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"recording": recordingID}}},
		{{Key: "$group", Value: bson.M{
			"_id":            "$recording",
			"countChunks":    bson.M{"$sum": 1},
			"totalSizeBytes": bson.M{"$sum": "$fileSizeBytes"},
		}}},
	})
	if err != nil {
		return ChunkAggregate{}, err
	}
	defer cursor.Close(ctx)

	var rows []struct {
		CountChunks    int   `bson:"countChunks"`
		TotalSizeBytes int64 `bson:"totalSizeBytes"`
	}
	if err := cursor.All(ctx, &rows); err != nil {
		return ChunkAggregate{}, err
	}
	if len(rows) == 0 {
		return ChunkAggregate{}, nil
	}

	return ChunkAggregate{
		CountChunks:    rows[0].CountChunks,
		TotalSizeBytes: rows[0].TotalSizeBytes,
	}, nil
}

func (r *MongoRepository) UpdateRecordingTotals(ctx context.Context, recordingID primitive.ObjectID, update RecordingTotalsUpdate) (*RecordingDocument, error) {
	now := r.now()
	setFields := bson.M{
		"totalChunks": update.TotalChunks,
		"totalSizeMB": update.TotalSizeMB,
		"updatedAt":   now,
	}
	if update.HasFinalChunk {
		setFields["hasFinalChunk"] = true
		setFields["status"] = update.Status
	}

	findOptions := options.FindOneAndUpdate().
		SetReturnDocument(options.After)

	var recording RecordingDocument
	if err := r.recordings.FindOneAndUpdate(
		ctx,
		bson.M{"_id": recordingID},
		bson.M{"$set": setFields},
		findOptions,
	).Decode(&recording); err != nil {
		return nil, err
	}

	return &recording, nil
}

func (r *MongoRepository) FindRecordingByMatch(ctx context.Context, matchID primitive.ObjectID) (*RecordingDocument, error) {
	findOptions := options.FindOne().SetSort(bson.D{{Key: "updatedAt", Value: -1}})

	var recording RecordingDocument
	err := r.recordings.FindOne(ctx, bson.M{"match": matchID}, findOptions).Decode(&recording)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &recording, nil
}

func (r *MongoRepository) ListChunksByRecording(ctx context.Context, recordingID primitive.ObjectID) ([]ChunkDocument, error) {
	findOptions := options.Find().SetSort(bson.D{{Key: "chunkIndex", Value: 1}})

	cursor, err := r.chunks.Find(ctx, bson.M{"recording": recordingID}, findOptions)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	chunks := make([]ChunkDocument, 0)
	if err := cursor.All(ctx, &chunks); err != nil {
		return nil, err
	}

	return chunks, nil
}
