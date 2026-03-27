package recordingsv2

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	defaultRecordingPartSizeBytes = 8 * 1024 * 1024
	minMultipartPartSizeBytes     = 5 * 1024 * 1024
)

type StorageDriver interface {
	PartSizeBytes() int64
	CreateSegmentUploadURL(ctx context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error)
	CreateManifestUploadURL(ctx context.Context, target StorageTarget, objectKey string) (map[string]any, error)
	CreateObjectDownloadURL(ctx context.Context, target StorageTarget, objectKey string, expiresIn time.Duration) (map[string]any, error)
	StartMultipartUpload(ctx context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error)
	CreateMultipartPartUploadURL(ctx context.Context, target StorageTarget, objectKey, uploadID string, partNumber int) (map[string]any, error)
	CompleteMultipartUpload(ctx context.Context, target StorageTarget, objectKey, uploadID string, parts []map[string]any) error
	AbortMultipartUpload(ctx context.Context, target StorageTarget, objectKey, uploadID string) error
	PutJSON(ctx context.Context, target StorageTarget, objectKey string, payload any, cacheControl string) error
	DownloadObjectToFile(ctx context.Context, target StorageTarget, objectKey, targetPath string) error
	DeleteObjects(ctx context.Context, target StorageTarget, objectKeys []string) ([]string, error)
}

type R2StorageDriver struct {
	mu      sync.Mutex
	clients map[string]*s3.Client
}

func NewR2StorageDriver() *R2StorageDriver {
	return &R2StorageDriver{
		clients: map[string]*s3.Client{},
	}
}

func (d *R2StorageDriver) PartSizeBytes() int64 {
	raw := strings.TrimSpace(firstNonEmptyString(
		os.Getenv("R2_RECORDINGS_PART_SIZE_BYTES"),
		"",
	))
	value, err := strconv.ParseInt(raw, 10, 64)
	if err == nil && value >= minMultipartPartSizeBytes {
		return value
	}
	return defaultRecordingPartSizeBytes
}

func (d *R2StorageDriver) CreateSegmentUploadURL(ctx context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error) {
	return d.presignPutObject(ctx, target, objectKey, contentType, 20*time.Minute, "public, max-age=31536000, immutable")
}

func (d *R2StorageDriver) CreateManifestUploadURL(ctx context.Context, target StorageTarget, objectKey string) (map[string]any, error) {
	return d.presignPutObject(ctx, target, objectKey, "application/json; charset=utf-8", 12*time.Hour, "public, max-age=2, stale-while-revalidate=4")
}

func (d *R2StorageDriver) CreateObjectDownloadURL(ctx context.Context, target StorageTarget, objectKey string, expiresIn time.Duration) (map[string]any, error) {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return nil, err
	}
	presignClient := s3.NewPresignClient(client)
	result, err := presignClient.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(target.BucketName),
		Key:    aws.String(objectKey),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expiresIn
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"downloadUrl":      result.URL,
		"objectKey":        objectKey,
		"expiresInSeconds": int(expiresIn / time.Second),
		"method":           http.MethodGet,
		"storageTargetId":  target.ID,
		"bucketName":       target.BucketName,
	}, nil
}

func (d *R2StorageDriver) StartMultipartUpload(ctx context.Context, target StorageTarget, objectKey, contentType string) (map[string]any, error) {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return nil, err
	}
	result, err := client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:       aws.String(target.BucketName),
		Key:          aws.String(objectKey),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String("public, max-age=31536000, immutable"),
	})
	if err != nil {
		return nil, err
	}
	if result.UploadId == nil || strings.TrimSpace(*result.UploadId) == "" {
		return nil, fmt.Errorf("R2 did not return multipart upload id")
	}
	return map[string]any{
		"uploadId":        strings.TrimSpace(*result.UploadId),
		"objectKey":       objectKey,
		"partSizeBytes":   d.PartSizeBytes(),
		"contentType":     contentType,
		"storageTargetId": target.ID,
		"bucketName":      target.BucketName,
	}, nil
}

func (d *R2StorageDriver) CreateMultipartPartUploadURL(ctx context.Context, target StorageTarget, objectKey, uploadID string, partNumber int) (map[string]any, error) {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return nil, err
	}
	presignClient := s3.NewPresignClient(client)
	result, err := presignClient.PresignUploadPart(ctx, &s3.UploadPartInput{
		Bucket:     aws.String(target.BucketName),
		Key:        aws.String(objectKey),
		UploadId:   aws.String(uploadID),
		PartNumber: aws.Int32(int32(partNumber)),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = 20 * time.Minute
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"uploadUrl":        result.URL,
		"objectKey":        objectKey,
		"uploadId":         uploadID,
		"partNumber":       partNumber,
		"expiresInSeconds": 1200,
		"method":           http.MethodPut,
		"headers":          map[string]any{},
		"storageTargetId":  target.ID,
		"bucketName":       target.BucketName,
	}, nil
}

func (d *R2StorageDriver) CompleteMultipartUpload(ctx context.Context, target StorageTarget, objectKey, uploadID string, parts []map[string]any) error {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return err
	}
	completed := make([]types.CompletedPart, 0, len(parts))
	for _, part := range parts {
		partNumber := int32(numberFromValue(part["partNumber"]))
		etag := strings.TrimSpace(stringFromValue(part["etag"]))
		if partNumber <= 0 || etag == "" {
			continue
		}
		completed = append(completed, types.CompletedPart{
			ETag:       aws.String(etag),
			PartNumber: aws.Int32(partNumber),
		})
	}
	if len(completed) == 0 {
		return fmt.Errorf("multipart completion requires at least one uploaded part")
	}
	_, err = client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(target.BucketName),
		Key:      aws.String(objectKey),
		UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completed,
		},
	})
	return err
}

func (d *R2StorageDriver) AbortMultipartUpload(ctx context.Context, target StorageTarget, objectKey, uploadID string) error {
	if strings.TrimSpace(uploadID) == "" {
		return nil
	}
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return err
	}
	_, err = client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(target.BucketName),
		Key:      aws.String(objectKey),
		UploadId: aws.String(uploadID),
	})
	return err
}

func (d *R2StorageDriver) PutJSON(ctx context.Context, target StorageTarget, objectKey string, payload any, cacheControl string) error {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(target.BucketName),
		Key:          aws.String(objectKey),
		Body:         bytes.NewReader(body),
		ContentType:  aws.String("application/json; charset=utf-8"),
		CacheControl: aws.String(cacheControl),
	})
	return err
}

func (d *R2StorageDriver) DownloadObjectToFile(ctx context.Context, target StorageTarget, objectKey, targetPath string) error {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return err
	}
	response, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(target.BucketName),
		Key:    aws.String(objectKey),
	})
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return err
	}
	file, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := io.Copy(file, response.Body); err != nil {
		return err
	}
	return nil
}

func (d *R2StorageDriver) DeleteObjects(ctx context.Context, target StorageTarget, objectKeys []string) ([]string, error) {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return nil, err
	}

	filtered := make([]string, 0, len(objectKeys))
	seen := map[string]struct{}{}
	for _, objectKey := range objectKeys {
		objectKey = strings.TrimSpace(objectKey)
		if objectKey == "" {
			continue
		}
		if _, exists := seen[objectKey]; exists {
			continue
		}
		seen[objectKey] = struct{}{}
		filtered = append(filtered, objectKey)
	}
	if len(filtered) == 0 {
		return nil, nil
	}

	deletedKeys := make([]string, 0, len(filtered))
	for start := 0; start < len(filtered); start += 1000 {
		end := start + 1000
		if end > len(filtered) {
			end = len(filtered)
		}
		chunk := filtered[start:end]
		objects := make([]types.ObjectIdentifier, 0, len(chunk))
		for _, objectKey := range chunk {
			objects = append(objects, types.ObjectIdentifier{Key: aws.String(objectKey)})
		}
		_, err := client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(target.BucketName),
			Delete: &types.Delete{
				Objects: objects,
				Quiet:   aws.Bool(true),
			},
		})
		if err != nil {
			return deletedKeys, err
		}
		deletedKeys = append(deletedKeys, chunk...)
	}

	return deletedKeys, nil
}

func (d *R2StorageDriver) presignPutObject(ctx context.Context, target StorageTarget, objectKey, contentType string, expires time.Duration, cacheControl string) (map[string]any, error) {
	client, err := d.clientForTarget(ctx, target)
	if err != nil {
		return nil, err
	}
	presignClient := s3.NewPresignClient(client)
	result, err := presignClient.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(target.BucketName),
		Key:          aws.String(objectKey),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String(cacheControl),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = expires
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"uploadUrl":        result.URL,
		"objectKey":        objectKey,
		"expiresInSeconds": int(expires / time.Second),
		"method":           http.MethodPut,
		"headers": map[string]any{
			"Content-Type": contentType,
		},
		"storageTargetId": target.ID,
		"bucketName":      target.BucketName,
	}, nil
}

func (d *R2StorageDriver) clientForTarget(ctx context.Context, target StorageTarget) (*s3.Client, error) {
	cacheKey := strings.Join([]string{
		target.ID,
		target.Endpoint,
		target.BucketName,
		target.AccessKeyID,
		target.SecretAccessKey,
	}, "|")

	d.mu.Lock()
	client := d.clients[cacheKey]
	d.mu.Unlock()
	if client != nil {
		return client, nil
	}

	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion("auto"),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			target.AccessKeyID,
			target.SecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, err
	}
	client = s3.NewFromConfig(cfg, func(opts *s3.Options) {
		opts.BaseEndpoint = aws.String(strings.TrimSpace(target.Endpoint))
		opts.UsePathStyle = true
	})

	d.mu.Lock()
	d.clients[cacheKey] = client
	d.mu.Unlock()
	return client, nil
}
