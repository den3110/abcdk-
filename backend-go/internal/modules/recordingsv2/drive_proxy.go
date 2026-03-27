package recordingsv2

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	googleoauth "golang.org/x/oauth2/google"
)

const (
	driveTokenURI = "https://oauth2.googleapis.com/token"
	driveScope    = "https://www.googleapis.com/auth/drive"
)

type recordingDriveRuntimeConfig struct {
	Enabled               bool
	Mode                  string
	FolderID              string
	SharedDriveID         string
	ServiceAccountEmail   string
	PrivateKey            string
	ClientID              string
	ClientSecret          string
	RedirectURI           string
	RefreshToken          string
	RefreshTokenMalformed bool
}

type googleDriveProxy struct {
	repository Repository
}

func NewGoogleDriveProxy(repository Repository) DriveProxy {
	return &googleDriveProxy{repository: repository}
}

func (p *googleDriveProxy) Probe(ctx context.Context, fileID string) (*DriveProbeResult, error) {
	response, authMode, err := p.requestMedia(ctx, fileID, "bytes=0-0")
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	return &DriveProbeResult{
		DriveAuthMode: authMode,
		StatusCode:    response.StatusCode,
		ContentType:   firstNonEmptyString(strings.TrimSpace(response.Header.Get("Content-Type")), "video/mp4"),
		ContentLength: emptyStringToNilString(response.Header.Get("Content-Length")),
		ContentRange:  emptyStringToNilString(response.Header.Get("Content-Range")),
		AcceptRanges:  firstNonEmptyString(strings.TrimSpace(response.Header.Get("Accept-Ranges")), "bytes"),
		CheckedAt:     time.Now().UTC(),
	}, nil
}

func (p *googleDriveProxy) Stream(ctx context.Context, fileID, rangeHeader string) (*DriveStreamResult, error) {
	response, authMode, err := p.requestMedia(ctx, fileID, rangeHeader)
	if err != nil {
		return nil, err
	}
	return &DriveStreamResult{
		StatusCode:    response.StatusCode,
		Headers:       response.Header.Clone(),
		Body:          response.Body,
		DriveAuthMode: authMode,
	}, nil
}

func (p *googleDriveProxy) UploadFile(ctx context.Context, filePath, fileName, mimeType string) (*DriveUploadResult, error) {
	runtimeConfig, err := p.loadRuntimeConfig(ctx)
	if err != nil {
		return nil, err
	}
	tokenSource, driveAuthMode, usingSharedDrive, err := p.buildTokenSource(ctx, runtimeConfig)
	if err != nil {
		return nil, err
	}

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	if fileName = strings.TrimSpace(fileName); fileName == "" {
		fileName = filepath.Base(filePath)
	}
	if mimeType = strings.TrimSpace(mimeType); mimeType == "" {
		mimeType = "video/mp4"
	}

	metadata := map[string]any{
		"name": fileName,
	}
	if runtimeConfig.FolderID != "" {
		metadata["parents"] = []string{runtimeConfig.FolderID}
	}
	metadataBody, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}

	requestURL := "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink,size"
	if usingSharedDrive {
		requestURL += "&supportsAllDrives=true"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(string(metadataBody)))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json; charset=UTF-8")
	request.Header.Set("X-Upload-Content-Type", mimeType)
	request.Header.Set("X-Upload-Content-Length", strconv.FormatInt(fileInfo.Size(), 10))

	client := oauth2.NewClient(ctx, tokenSource)
	response, err := client.Do(request)
	if err != nil {
		return nil, normalizeDriveError(err, runtimeConfig)
	}
	if response.StatusCode >= http.StatusBadRequest {
		defer response.Body.Close()
		return nil, normalizeDriveHTTPError(response, runtimeConfig)
	}
	_ = response.Body.Close()

	uploadURL := strings.TrimSpace(response.Header.Get("Location"))
	if uploadURL == "" {
		return nil, errors.New("Drive upload session did not return a location")
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	uploadRequest, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, file)
	if err != nil {
		return nil, err
	}
	uploadRequest.Header.Set("Content-Length", strconv.FormatInt(fileInfo.Size(), 10))
	uploadRequest.Header.Set("Content-Type", mimeType)

	uploadResponse, err := client.Do(uploadRequest)
	if err != nil {
		return nil, normalizeDriveError(err, runtimeConfig)
	}
	defer uploadResponse.Body.Close()
	if uploadResponse.StatusCode >= http.StatusBadRequest {
		return nil, normalizeDriveHTTPError(uploadResponse, runtimeConfig)
	}

	var uploadPayload struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(uploadResponse.Body).Decode(&uploadPayload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(uploadPayload.ID) == "" {
		return nil, errors.New("Drive upload completed without returning a file id")
	}

	permissionURL := "https://www.googleapis.com/drive/v3/files/" + url.PathEscape(uploadPayload.ID) + "/permissions"
	if usingSharedDrive {
		permissionURL += "?supportsAllDrives=true"
	}
	permissionBody := `{"role":"reader","type":"anyone"}`
	permissionRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, permissionURL, strings.NewReader(permissionBody))
	if err != nil {
		return nil, err
	}
	permissionRequest.Header.Set("Content-Type", "application/json; charset=UTF-8")

	permissionResponse, err := client.Do(permissionRequest)
	if err != nil {
		return nil, normalizeDriveError(err, runtimeConfig)
	}
	defer permissionResponse.Body.Close()
	if permissionResponse.StatusCode >= http.StatusBadRequest {
		return nil, normalizeDriveHTTPError(permissionResponse, runtimeConfig)
	}

	return &DriveUploadResult{
		FileID:        uploadPayload.ID,
		RawURL:        "https://drive.google.com/uc?export=download&id=" + uploadPayload.ID,
		PreviewURL:    "https://drive.google.com/file/d/" + uploadPayload.ID + "/preview",
		DriveAuthMode: driveAuthMode,
		SizeBytes:     fileInfo.Size(),
	}, nil
}

func (p *googleDriveProxy) requestMedia(ctx context.Context, fileID, rangeHeader string) (*http.Response, string, error) {
	fileID = strings.TrimSpace(fileID)
	if fileID == "" {
		return nil, "", errors.New("Drive file id is required")
	}

	runtimeConfig, err := p.loadRuntimeConfig(ctx)
	if err != nil {
		return nil, "", err
	}
	tokenSource, driveAuthMode, usingSharedDrive, err := p.buildTokenSource(ctx, runtimeConfig)
	if err != nil {
		return nil, "", err
	}

	requestURL := "https://www.googleapis.com/drive/v3/files/" + url.PathEscape(fileID) + "?alt=media&acknowledgeAbuse=true"
	if usingSharedDrive {
		requestURL += "&supportsAllDrives=true"
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, "", err
	}
	if strings.TrimSpace(rangeHeader) != "" {
		request.Header.Set("Range", strings.TrimSpace(rangeHeader))
	}

	response, err := oauth2.NewClient(ctx, tokenSource).Do(request)
	if err != nil {
		return nil, "", normalizeDriveError(err, runtimeConfig)
	}
	if response.StatusCode >= http.StatusBadRequest {
		defer response.Body.Close()
		return nil, "", normalizeDriveHTTPError(response, runtimeConfig)
	}
	return response, driveAuthMode, nil
}

func (p *googleDriveProxy) loadRuntimeConfig(ctx context.Context) (recordingDriveRuntimeConfig, error) {
	systemSettings, err := p.repository.LoadSystemSettings(ctx)
	if err != nil {
		return recordingDriveRuntimeConfig{}, err
	}
	recordingDrive := mapFromValue(systemSettings["recordingDrive"])
	mode := normalizeDriveMode(stringFromValue(recordingDrive["mode"]))
	runtimeConfig := recordingDriveRuntimeConfig{
		Enabled:       recordingDrive["enabled"] != false,
		Mode:          mode,
		FolderID:      firstNonEmptyString(strings.TrimSpace(stringFromValue(recordingDrive["folderId"])), strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_FOLDER_ID"))),
		SharedDriveID: firstNonEmptyString(strings.TrimSpace(stringFromValue(recordingDrive["sharedDriveId"])), strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_SHARED_DRIVE_ID"))),
	}

	if mode == "oauthUser" {
		values, err := p.repository.LoadConfigValues(
			ctx,
			"GOOGLE_CLIENT_DRIVE_ID",
			"GOOGLE_CLIENT_DRIVE_SECRET",
			"GOOGLE_REDIRECT_DRIVE_URI",
			"GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN",
		)
		if err != nil {
			return recordingDriveRuntimeConfig{}, err
		}

		clientSecret, err := decryptSecretValue(firstNonEmptyString(values["GOOGLE_CLIENT_DRIVE_SECRET"], strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_DRIVE_SECRET")), strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET"))))
		if err != nil {
			return recordingDriveRuntimeConfig{}, err
		}
		refreshToken, err := decryptSecretValue(firstNonEmptyString(values["GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN"], strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_REFRESH_TOKEN"))))
		if err != nil {
			return recordingDriveRuntimeConfig{}, err
		}

		runtimeConfig.ClientID = firstNonEmptyString(values["GOOGLE_CLIENT_DRIVE_ID"], strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_DRIVE_ID")), strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")))
		runtimeConfig.ClientSecret = clientSecret
		runtimeConfig.RedirectURI = firstNonEmptyString(values["GOOGLE_REDIRECT_DRIVE_URI"], strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_DRIVE_URI")), strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URI")))
		runtimeConfig.RefreshToken = refreshToken
		return runtimeConfig, nil
	}

	privateKey, err := decryptSecretValue(strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_PRIVATE_KEY")))
	if err != nil {
		return recordingDriveRuntimeConfig{}, err
	}
	runtimeConfig.ServiceAccountEmail = strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_RECORDINGS_SERVICE_ACCOUNT_EMAIL"))
	runtimeConfig.PrivateKey = normalizePrivateKey(privateKey)
	return runtimeConfig, nil
}

func (p *googleDriveProxy) buildTokenSource(ctx context.Context, runtimeConfig recordingDriveRuntimeConfig) (oauth2.TokenSource, string, bool, error) {
	if !runtimeConfig.Enabled {
		return nil, "", false, errors.New("Google Drive recording output is disabled")
	}

	if runtimeConfig.Mode == "oauthUser" {
		if runtimeConfig.ClientID == "" || runtimeConfig.ClientSecret == "" {
			return nil, "", false, errors.New("Thieu GOOGLE_CLIENT_DRIVE_ID / GOOGLE_CLIENT_DRIVE_SECRET trong System Config")
		}
		if runtimeConfig.RefreshToken == "" {
			return nil, "", false, errors.New("My Drive OAuth chua ket noi")
		}
		if runtimeConfig.RedirectURI == "" {
			return nil, "", false, errors.New("Thieu GOOGLE_REDIRECT_DRIVE_URI trong System Config")
		}

		config := &oauth2.Config{
			ClientID:     runtimeConfig.ClientID,
			ClientSecret: runtimeConfig.ClientSecret,
			RedirectURL:  runtimeConfig.RedirectURI,
			Endpoint:     googleoauth.Endpoint,
			Scopes:       []string{driveScope},
		}
		return config.TokenSource(ctx, &oauth2.Token{RefreshToken: runtimeConfig.RefreshToken}), "oauthUser", false, nil
	}

	if runtimeConfig.ServiceAccountEmail == "" || runtimeConfig.PrivateKey == "" {
		return nil, "", false, errors.New("Google Drive service account is not configured")
	}

	credentialsJSON, err := json.Marshal(map[string]string{
		"type":         "service_account",
		"client_email": runtimeConfig.ServiceAccountEmail,
		"private_key":  runtimeConfig.PrivateKey,
		"token_uri":    driveTokenURI,
	})
	if err != nil {
		return nil, "", false, err
	}

	jwtConfig, err := googleoauth.JWTConfigFromJSON(credentialsJSON, driveScope)
	if err != nil {
		return nil, "", false, err
	}
	return jwtConfig.TokenSource(ctx), "serviceAccount", true, nil
}

func normalizePrivateKey(raw string) string {
	return strings.TrimSpace(strings.ReplaceAll(raw, "\\n", "\n"))
}

func normalizeDriveMode(value string) string {
	if strings.TrimSpace(value) == "oauthUser" {
		return "oauthUser"
	}
	return "serviceAccount"
}

func normalizeDriveHTTPError(response *http.Response, runtimeConfig recordingDriveRuntimeConfig) error {
	body, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	message := extractDriveErrorMessage(string(body))
	if message == "" {
		message = response.Status
	}
	return normalizeDriveError(fmt.Errorf("%s", message), runtimeConfig)
}

func extractDriveErrorMessage(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}

	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err == nil {
		return strings.TrimSpace(payload.Error.Message)
	}
	return body
}

func normalizeDriveError(err error, runtimeConfig recordingDriveRuntimeConfig) error {
	if err == nil {
		return nil
	}

	message := strings.TrimSpace(err.Error())
	switch {
	case strings.Contains(strings.ToLower(message), "service accounts do not have storage quota"):
		return errors.New("Service account khong the upload vao My Drive. Hay dung Shared Drive hoac chuyen sang My Drive OAuth.")
	case strings.Contains(strings.ToLower(message), "file not found"):
		return errors.New("Folder dich khong truy cap duoc hoac khong ton tai.")
	case strings.Contains(strings.ToLower(message), "invalid_grant"):
		if runtimeConfig.RefreshTokenMalformed {
			return errors.New("Refresh token Recording Drive luu sai dinh dang. Hay ket noi lai.")
		}
		return errors.New("My Drive OAuth het han hoac da bi revoke. Hay ket noi lai.")
	case runtimeConfig.Mode == "oauthUser" && (strings.Contains(strings.ToLower(message), "login required") || strings.Contains(strings.ToLower(message), "auth")):
		return errors.New("My Drive OAuth chua ket noi hop le.")
	default:
		return errors.New(message)
	}
}

func decryptSecretValue(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "enc:gcm:") {
		return value, nil
	}

	for _, key := range [][]byte{
		decodeSecretKey(strings.TrimSpace(os.Getenv("LIVE_SECRET_KEY_BASE64"))),
		decodeSecretKey(strings.TrimSpace(os.Getenv("LIVE_SECRET_KEY_BASE64_OLD"))),
	} {
		if len(key) == 0 {
			continue
		}
		plain, err := decryptGCMString(value, key)
		if err == nil {
			return plain, nil
		}
	}

	return "", errors.New("Failed to decrypt token with provided keys")
}

func decodeSecretKey(raw string) []byte {
	if raw == "" {
		return nil
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(decoded) != 32 {
		return nil
	}
	return decoded
}

func decryptGCMString(value string, key []byte) (string, error) {
	payload := strings.TrimPrefix(value, "enc:gcm:")
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", err
	}
	if len(raw) < 29 {
		return "", errors.New("ciphertext too short")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	nonce := raw[:nonceSize]
	ciphertext := raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func serializeDriveProbe(probe *DriveProbeResult) map[string]any {
	if probe == nil {
		return nil
	}
	return map[string]any{
		"ready":         true,
		"driveAuthMode": emptyStringToNil(probe.DriveAuthMode),
		"statusCode":    probe.StatusCode,
		"contentType":   emptyStringToNil(probe.ContentType),
		"contentLength": emptyStringToNil(probe.ContentLength),
		"contentRange":  emptyStringToNil(probe.ContentRange),
		"acceptRanges":  emptyStringToNil(probe.AcceptRanges),
		"checkedAt":     probe.CheckedAt,
	}
}

func emptyStringToNilString(value string) string {
	return strings.TrimSpace(value)
}
