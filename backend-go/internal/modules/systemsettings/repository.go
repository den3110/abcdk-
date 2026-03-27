package systemsettings

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type RegistrationSettings struct {
	Open                         *bool `bson:"open,omitempty" json:"open,omitempty"`
	RequireOptionalProfileFields *bool `bson:"requireOptionalProfileFields,omitempty" json:"requireOptionalProfileFields,omitempty"`
}

type OTASettings struct {
	ForceUpdateEnabled *bool `bson:"forceUpdateEnabled,omitempty" json:"forceUpdateEnabled,omitempty"`
}

type Document struct {
	ID           string               `bson:"_id" json:"_id"`
	Registration RegistrationSettings `bson:"registration,omitempty" json:"registration,omitempty"`
	OTA          OTASettings          `bson:"ota,omitempty" json:"ota,omitempty"`
	UpdatedAt    time.Time            `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

type Repository interface {
	GetOrCreate(ctx context.Context) (*Document, error)
}

type MongoRepository struct {
	collection *mongo.Collection
	now        func() time.Time
}

func NewMongoRepository(db *mongo.Database) *MongoRepository {
	return &MongoRepository{
		collection: db.Collection("systemsettings"),
		now:        time.Now,
	}
}

func (r *MongoRepository) GetOrCreate(ctx context.Context) (*Document, error) {
	defaults := DefaultDocument(r.now())
	update := bson.M{
		"$setOnInsert": bson.M{
			"_id": defaults.ID,
			"registration": bson.M{
				"open":                         true,
				"requireOptionalProfileFields": true,
			},
			"ota": bson.M{
				"forceUpdateEnabled": false,
			},
			"updatedAt": defaults.UpdatedAt,
		},
	}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var doc Document
	if err := r.collection.FindOneAndUpdate(ctx, bson.M{"_id": defaults.ID}, update, opts).Decode(&doc); err != nil {
		return nil, err
	}

	return &doc, nil
}

func DefaultDocument(now time.Time) Document {
	open := true
	requireOptional := true
	forceUpdate := false

	return Document{
		ID: "system",
		Registration: RegistrationSettings{
			Open:                         &open,
			RequireOptionalProfileFields: &requireOptional,
		},
		OTA: OTASettings{
			ForceUpdateEnabled: &forceUpdate,
		},
		UpdatedAt: now.UTC(),
	}
}

func RegistrationOpen(doc *Document) bool {
	if doc != nil && doc.Registration.Open != nil {
		return *doc.Registration.Open
	}
	return true
}

func RegistrationRequireOptionalProfileFields(doc *Document) bool {
	if doc != nil && doc.Registration.RequireOptionalProfileFields != nil {
		return *doc.Registration.RequireOptionalProfileFields
	}
	return true
}

func OTAAllowed(doc *Document) bool {
	if doc != nil && doc.OTA.ForceUpdateEnabled != nil {
		return *doc.OTA.ForceUpdateEnabled
	}
	return false
}
