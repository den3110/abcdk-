package observer

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func (s *service) ingestLiveDeviceHeartbeat(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}

	now := time.Now().UTC()
	source := s.extractSourceWithFallback(c, asString(body["source"]), s.cfg.LiveDeviceSourceName)
	status := toMap(body["status"])
	if len(status) == 0 {
		status = body
	}
	deviceID := firstString(
		body["deviceId"],
		status["deviceId"],
		status["clientSessionId"],
		status["clientSessionIdRaw"],
	)
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"ok":      false,
			"message": "deviceId or clientSessionId is required",
		})
		return
	}

	capturedAt := parseTime(firstNonNil(body["capturedAt"], status["capturedAt"]))
	heartbeatIntervalMs := clampInt(
		parseInt(firstString(body["heartbeatIntervalMs"], status["heartbeatIntervalMs"]), 10_000),
		3_000,
		120_000,
	)
	staleAfterMs := clampInt(
		parseInt(firstString(body["staleAfterMs"], status["staleAfterMs"]), maxInt(s.cfg.LiveDeviceStaleMs, heartbeatIntervalMs*3)),
		heartbeatIntervalMs,
		10*60*1000,
	)

	principal := devicePrincipalFromContext(c)
	operator := mergePrincipalOperator(status, principal)
	warnings := normalizeStringList(firstNonNil(status["warnings"], body["warnings"]))
	diagnostics := normalizeStringList(firstNonNil(status["diagnostics"], body["diagnostics"]))
	recovery := firstObject(status["recovery"])
	overlay := firstObject(status["overlay"])
	stream := firstObject(status["stream"])
	recording := firstObject(status["recording"])
	thermal := firstObject(status["thermal"])
	battery := firstObject(status["battery"])
	network := firstObject(status["network"])
	presence := firstObject(status["presence"])
	route := firstObject(status["route"])
	court := firstObject(status["court"])
	match := firstObject(status["match"])
	app := firstObject(status["app"])
	device := firstObject(status["device"])

	update := bson.M{
		"$set": bson.M{
			"source":             source,
			"deviceId":           deviceID,
			"platform":           defaultString(firstString(status["platform"], device["platform"]), "ios"),
			"deviceName":         firstString(device["name"], status["deviceName"]),
			"deviceModel":        firstString(device["model"], status["deviceModel"]),
			"operatorUserId":     firstString(operator["userId"]),
			"operatorName":       firstString(operator["displayName"], operator["name"]),
			"operatorRole":       firstString(operator["role"]),
			"routeLabel":         firstString(route["label"], status["routeLabel"]),
			"screenState":        firstString(status["screenState"], presence["screenState"]),
			"courtId":            firstString(court["id"], status["courtId"]),
			"courtName":          firstString(court["name"], status["courtName"]),
			"matchId":            firstString(match["id"], status["matchId"]),
			"matchCode":          firstString(match["code"], status["matchCode"]),
			"streamState":        firstString(stream["state"], status["streamState"]),
			"overlayIssue":       firstString(overlay["issue"], overlay["lastIssue"], status["overlayIssue"]),
			"recoverySeverity":   firstString(recovery["severity"]),
			"recoveryStage":      firstString(recovery["stage"]),
			"warningCount":       len(warnings),
			"heartbeatIntervalMs": heartbeatIntervalMs,
			"staleAfterMs":       staleAfterMs,
			"capturedAt":         capturedAt,
			"lastSeenAt":         now,
			"receivedAt":         now,
			"expireAt":           buildExpireAt(s.cfg.LiveDeviceTTLDays, now),
			"app":                app,
			"device":             device,
			"operator":           operator,
			"route":              route,
			"court":              court,
			"match":              match,
			"stream":             stream,
			"recording":          recording,
			"overlay":            overlay,
			"presence":           presence,
			"network":            network,
			"battery":            battery,
			"thermal":            thermal,
			"recovery":           recovery,
			"warnings":           warnings,
			"diagnostics":        diagnostics,
			"payload":            status,
			"updatedAt":          now,
		},
		"$setOnInsert": bson.M{
			"createdAt": now,
		},
	}

	if _, err := s.liveDevices.UpdateOne(
		c.Request.Context(),
		bson.M{"source": source, "deviceId": deviceID},
		update,
		options.Update().SetUpsert(true),
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to save live device heartbeat",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":       true,
		"source":   source,
		"deviceId": deviceID,
	})
}

func (s *service) ingestLiveDeviceEvent(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}

	source := s.extractSourceWithFallback(c, asString(body["source"]), s.cfg.LiveDeviceSourceName)
	event := toMap(body["event"])
	if len(event) == 0 {
		event = body
	}
	status := toMap(body["status"])
	principal := devicePrincipalFromContext(c)
	occurredAt := parseTime(firstNonNil(event["occurredAt"], event["capturedAt"], body["capturedAt"]))
	deviceID := firstString(
		event["deviceId"],
		body["deviceId"],
		status["deviceId"],
		status["clientSessionId"],
	)
	level := normalizeLevel(firstString(event["level"]), "warn")
	payload := firstObject(event["payload"])
	if len(payload) == 0 {
		payload = map[string]any{}
	}
	if deviceID != "" {
		payload["deviceId"] = deviceID
	}
	if len(status) > 0 {
		payload["status"] = status
	}
	if principal != nil {
		if principal.UserID != "" {
			payload["authUserId"] = principal.UserID
		}
		if principal.Role != "" {
			payload["authRole"] = principal.Role
		}
	}

	doc := bson.M{
		"source":     source,
		"category":   "live_device",
		"type":       defaultString(firstString(event["type"], event["reasonCode"]), "heartbeat_event"),
		"level":      level,
		"requestId":  "",
		"method":     "",
		"path":       "",
		"url":        "",
		"statusCode": nil,
		"durationMs": nil,
		"ip":         "",
		"tags": normalizeTags(firstNonNil(
			event["tags"],
			[]any{
				firstString(event["reasonCode"]),
				firstString(event["stage"]),
				firstString(event["severity"]),
			},
		)),
		"occurredAt": occurredAt,
		"receivedAt": time.Now().UTC(),
		"expireAt":   buildExpireAt(s.cfg.EventTTLDays, occurredAt),
		"payload": mergeMaps(payload, map[string]any{
			"deviceId":      deviceID,
			"reasonCode":    firstString(event["reasonCode"]),
			"reasonText":    firstString(event["reasonText"], event["message"], event["summary"]),
			"stage":         firstString(event["stage"]),
			"severity":      firstString(event["severity"]),
			"matchId":       firstString(event["matchId"], status["matchId"]),
			"matchCode":     firstString(event["matchCode"], status["matchCode"]),
			"courtId":       firstString(event["courtId"], status["courtId"]),
			"courtName":     firstString(event["courtName"], status["courtName"]),
			"operatorUserId": firstString(event["operatorUserId"], status["operatorUserId"]),
			"operatorName":  firstString(event["operatorName"], status["operatorName"]),
		}),
		"createdAt": time.Now().UTC(),
		"updatedAt": time.Now().UTC(),
	}

	if _, err := s.events.InsertOne(c.Request.Context(), doc); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to save live device event",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":       true,
		"source":   source,
		"deviceId": deviceID,
	})
}

func (s *service) listLiveDevices(c *gin.Context) {
	source := strings.TrimSpace(c.Query("source"))
	platform := strings.TrimSpace(c.Query("platform"))
	onlineOnly := strings.EqualFold(strings.TrimSpace(c.Query("onlineOnly")), "true") ||
		strings.TrimSpace(c.Query("onlineOnly")) == "1"
	limit := clampInt(parseInt(c.DefaultQuery("limit", "50"), 50), 1, 200)

	filter := bson.M{}
	if source != "" {
		filter["source"] = source
	}
	if platform != "" {
		filter["platform"] = platform
	}

	cursor, err := s.liveDevices.Find(
		c.Request.Context(),
		filter,
		options.Find().
			SetSort(bson.D{{Key: "lastSeenAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetLimit(int64(limit)),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to load live devices",
			"error":   err.Error(),
		})
		return
	}
	defer cursor.Close(c.Request.Context())

	var rows []bson.M
	if err := cursor.All(c.Request.Context(), &rows); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to decode live devices",
			"error":   err.Error(),
		})
		return
	}

	now := time.Now().UTC()
	items := make([]gin.H, 0, len(rows))
	onlineCount := 0
	liveCount := 0
	overlayIssueCount := 0
	criticalCount := 0

	for _, row := range rows {
		lastSeenAt := parseTime(firstNonNil(row["lastSeenAt"], row["capturedAt"]))
		staleAfterMs := clampInt(parseInt(firstString(row["staleAfterMs"]), s.cfg.LiveDeviceStaleMs), 5_000, 10*60*1000)
		isOnline := now.Sub(lastSeenAt) <= time.Duration(staleAfterMs)*time.Millisecond
		if onlineOnly && !isOnline {
			continue
		}
		if isOnline {
			onlineCount += 1
		}
		streamState := strings.ToLower(firstString(row["streamState"]))
		if streamState == "live" || streamState == "connecting" || streamState == "reconnecting" {
			liveCount += 1
		}
		if firstString(row["overlayIssue"]) != "" {
			overlayIssueCount += 1
		}
		if strings.EqualFold(firstString(row["recoverySeverity"]), "critical") {
			criticalCount += 1
		}
		items = append(items, gin.H{
			"id":                formatID(row["_id"]),
			"source":            asString(row["source"]),
			"deviceId":          asString(row["deviceId"]),
			"platform":          asString(row["platform"]),
			"deviceName":        asString(row["deviceName"]),
			"deviceModel":       asString(row["deviceModel"]),
			"operatorUserId":    asString(row["operatorUserId"]),
			"operatorName":      asString(row["operatorName"]),
			"operatorRole":      asString(row["operatorRole"]),
			"routeLabel":        asString(row["routeLabel"]),
			"screenState":       asString(row["screenState"]),
			"courtId":           asString(row["courtId"]),
			"courtName":         asString(row["courtName"]),
			"matchId":           asString(row["matchId"]),
			"matchCode":         asString(row["matchCode"]),
			"streamState":       asString(row["streamState"]),
			"overlayIssue":      asString(row["overlayIssue"]),
			"recoverySeverity":  asString(row["recoverySeverity"]),
			"recoveryStage":     asString(row["recoveryStage"]),
			"warningCount":      clampInt(parseInt(firstString(row["warningCount"]), 0), 0, 999),
			"heartbeatIntervalMs": clampInt(parseInt(firstString(row["heartbeatIntervalMs"]), 10_000), 0, 120_000),
			"staleAfterMs":      staleAfterMs,
			"capturedAt":        row["capturedAt"],
			"lastSeenAt":        lastSeenAt,
			"isOnline":          isOnline,
			"app":               firstObject(row["app"]),
			"device":            firstObject(row["device"]),
			"operator":          firstObject(row["operator"]),
			"route":             firstObject(row["route"]),
			"court":             firstObject(row["court"]),
			"match":             firstObject(row["match"]),
			"stream":            firstObject(row["stream"]),
			"recording":         firstObject(row["recording"]),
			"overlay":           firstObject(row["overlay"]),
			"presence":          firstObject(row["presence"]),
			"network":           firstObject(row["network"]),
			"battery":           firstObject(row["battery"]),
			"thermal":           firstObject(row["thermal"]),
			"recovery":          firstObject(row["recovery"]),
			"warnings":          normalizeStringList(row["warnings"]),
			"diagnostics":       normalizeStringList(row["diagnostics"]),
			"payload":           firstObject(row["payload"]),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"counts": gin.H{
			"total":          len(items),
			"online":         onlineCount,
			"live":           liveCount,
			"overlayIssues":  overlayIssueCount,
			"criticalRecoveries": criticalCount,
		},
		"items": items,
	})
}

func (s *service) loadLiveDeviceSummary(ctx *gin.Context, source string) gin.H {
	filter := bson.M{}
	if strings.TrimSpace(source) != "" {
		filter["source"] = strings.TrimSpace(source)
	}
	cursor, err := s.liveDevices.Find(
		ctx.Request.Context(),
		filter,
		options.Find().
			SetSort(bson.D{{Key: "lastSeenAt", Value: -1}, {Key: "_id", Value: -1}}).
			SetLimit(12),
	)
	if err != nil {
		return gin.H{
			"counts": gin.H{},
			"items":  []gin.H{},
		}
	}
	defer cursor.Close(ctx.Request.Context())

	var rows []bson.M
	if err := cursor.All(ctx.Request.Context(), &rows); err != nil {
		return gin.H{
			"counts": gin.H{},
			"items":  []gin.H{},
		}
	}

	now := time.Now().UTC()
	items := make([]gin.H, 0, len(rows))
	counts := gin.H{
		"total":              0,
		"online":             0,
		"live":               0,
		"overlayIssues":      0,
		"criticalRecoveries": 0,
	}
	for _, row := range rows {
		lastSeenAt := parseTime(firstNonNil(row["lastSeenAt"], row["capturedAt"]))
		staleAfterMs := clampInt(parseInt(firstString(row["staleAfterMs"]), s.cfg.LiveDeviceStaleMs), 5_000, 10*60*1000)
		isOnline := now.Sub(lastSeenAt) <= time.Duration(staleAfterMs)*time.Millisecond
		counts["total"] = counts["total"].(int) + 1
		if isOnline {
			counts["online"] = counts["online"].(int) + 1
		}
		if strings.EqualFold(firstString(row["streamState"]), "live") {
			counts["live"] = counts["live"].(int) + 1
		}
		if firstString(row["overlayIssue"]) != "" {
			counts["overlayIssues"] = counts["overlayIssues"].(int) + 1
		}
		if strings.EqualFold(firstString(row["recoverySeverity"]), "critical") {
			counts["criticalRecoveries"] = counts["criticalRecoveries"].(int) + 1
		}
		items = append(items, gin.H{
			"deviceId":         asString(row["deviceId"]),
			"deviceName":       asString(row["deviceName"]),
			"operatorName":     asString(row["operatorName"]),
			"courtName":        asString(row["courtName"]),
			"matchCode":        asString(row["matchCode"]),
			"streamState":      asString(row["streamState"]),
			"overlayIssue":     asString(row["overlayIssue"]),
			"recoverySeverity": asString(row["recoverySeverity"]),
			"lastSeenAt":       lastSeenAt,
			"isOnline":         isOnline,
		})
	}
	return gin.H{
		"counts": counts,
		"items":  items,
	}
}

func mergePrincipalOperator(status map[string]any, principal *devicePrincipal) map[string]any {
	operator := firstObject(status["operator"])
	if principal == nil {
		return operator
	}
	if firstString(operator["userId"]) == "" && principal.UserID != "" {
		operator["userId"] = principal.UserID
	}
	if firstString(operator["role"]) == "" && principal.Role != "" {
		operator["role"] = principal.Role
	}
	return operator
}

func normalizeStringList(value any) []string {
	items := toSlice(value)
	if len(items) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text := strings.TrimSpace(asString(item))
		if text == "" {
			continue
		}
		out = append(out, text)
	}
	sort.Strings(out)
	return out
}

func mergeMaps(base map[string]any, extra map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range extra {
		if strings.TrimSpace(asString(value)) == "" {
			continue
		}
		out[key] = value
	}
	return out
}
