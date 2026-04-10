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

type liveDeviceEventEnvelope struct {
	source     string
	deviceID   string
	occurredAt time.Time
	level      string
	eventType  string
	reasonCode string
	reasonText string
	status     map[string]any
	doc        bson.M
}

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
			"source":              source,
			"deviceId":            deviceID,
			"platform":            defaultString(firstString(status["platform"], device["platform"]), "ios"),
			"deviceName":          firstString(device["name"], status["deviceName"]),
			"deviceModel":         firstString(device["model"], status["deviceModel"]),
			"deviceManufacturer":  firstString(device["manufacturer"], status["deviceManufacturer"]),
			"deviceBrand":         firstString(device["brand"], status["deviceBrand"]),
			"deviceProduct":       firstString(device["product"], status["deviceProduct"]),
			"operatorUserId":      firstString(operator["userId"]),
			"operatorName":        firstString(operator["displayName"], operator["name"]),
			"operatorRole":        firstString(operator["role"]),
			"routeLabel":          firstString(route["label"], status["routeLabel"]),
			"screenState":         firstString(status["screenState"], presence["screenState"]),
			"courtId":             firstString(court["id"], status["courtId"]),
			"courtName":           firstString(court["name"], status["courtName"]),
			"matchId":             firstString(match["id"], status["matchId"]),
			"matchCode":           firstString(match["code"], status["matchCode"]),
			"streamState":         firstString(stream["state"], status["streamState"]),
			"overlayIssue":        firstString(overlay["issue"], overlay["lastIssue"], status["overlayIssue"]),
			"recoverySeverity":    firstString(recovery["severity"]),
			"recoveryStage":       firstString(recovery["stage"]),
			"warningCount":        len(warnings),
			"heartbeatIntervalMs": heartbeatIntervalMs,
			"staleAfterMs":        staleAfterMs,
			"capturedAt":          capturedAt,
			"lastSeenAt":          now,
			"receivedAt":          now,
			"expireAt":            buildExpireAt(s.cfg.LiveDeviceTTLDays, now),
			"app":                 app,
			"device":              device,
			"operator":            operator,
			"route":               route,
			"court":               court,
			"match":               match,
			"stream":              stream,
			"recording":           recording,
			"overlay":             overlay,
			"presence":            presence,
			"network":             network,
			"battery":             battery,
			"thermal":             thermal,
			"recovery":            recovery,
			"warnings":            warnings,
			"diagnostics":         diagnostics,
			"payload":             status,
			"updatedAt":           now,
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

	envelope, ok := s.buildLiveDeviceEventEnvelope(c, body, asString(body["source"]))
	if !ok {
		return
	}
	if err := s.persistLiveDeviceEventEnvelopes(c, []liveDeviceEventEnvelope{envelope}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to save live device event",
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":       true,
		"source":   envelope.source,
		"deviceId": envelope.deviceID,
		"accepted": 1,
	})
}

func (s *service) ingestLiveDeviceEvents(c *gin.Context) {
	body, ok := bindJSONMap(c)
	if !ok {
		return
	}

	sourceFallback := asString(body["source"])
	incoming := toSlice(body["events"])
	if len(incoming) == 0 {
		if single := toMap(body["event"]); len(single) > 0 {
			incoming = []any{single}
		}
	}
	envelopes := make([]liveDeviceEventEnvelope, 0, minInt(len(incoming), 200))
	for _, item := range incoming[:minInt(len(incoming), 200)] {
		raw := toMap(item)
		if len(raw) == 0 {
			continue
		}
		envelope, accepted := s.buildLiveDeviceEventEnvelope(c, raw, sourceFallback)
		if !accepted {
			continue
		}
		envelopes = append(envelopes, envelope)
	}

	if err := s.persistLiveDeviceEventEnvelopes(c, envelopes); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"ok":      false,
			"message": "Failed to save live device events",
			"error":   err.Error(),
		})
		return
	}

	firstSource := sourceFallback
	firstDeviceID := ""
	if len(envelopes) > 0 {
		firstSource = envelopes[0].source
		firstDeviceID = envelopes[0].deviceID
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":       true,
		"source":   emptyStringToNil(firstSource),
		"deviceId": emptyStringToNil(firstDeviceID),
		"accepted": len(envelopes),
	})
}

func (s *service) buildLiveDeviceEventEnvelope(c *gin.Context, raw map[string]any, sourceFallback string) (liveDeviceEventEnvelope, bool) {
	source := s.extractSourceWithFallback(c, firstString(raw["source"], sourceFallback), s.cfg.LiveDeviceSourceName)
	event := toMap(raw["event"])
	if len(event) == 0 {
		event = raw
	}
	status := toMap(raw["status"])
	principal := devicePrincipalFromContext(c)
	occurredAt := parseTime(firstNonNil(event["occurredAt"], event["capturedAt"], raw["capturedAt"]))
	deviceID := firstString(
		event["deviceId"],
		raw["deviceId"],
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

	reasonCode := firstString(event["reasonCode"])
	reasonText := firstString(event["reasonText"], event["message"], event["summary"])
	eventType := defaultString(firstString(event["type"], reasonCode), "heartbeat_event")
	now := time.Now().UTC()
	doc := bson.M{
		"source":     source,
		"category":   "live_device",
		"type":       eventType,
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
				reasonCode,
				firstString(event["stage"]),
				firstString(event["severity"]),
			},
		)),
		"occurredAt": occurredAt,
		"receivedAt": now,
		"expireAt":   buildExpireAt(s.cfg.EventTTLDays, occurredAt),
		"payload": mergeMaps(payload, map[string]any{
			"deviceId":       deviceID,
			"reasonCode":     reasonCode,
			"reasonText":     reasonText,
			"stage":          firstString(event["stage"]),
			"severity":       firstString(event["severity"]),
			"matchId":        firstString(event["matchId"], status["matchId"]),
			"matchCode":      firstString(event["matchCode"], status["matchCode"]),
			"courtId":        firstString(event["courtId"], status["courtId"]),
			"courtName":      firstString(event["courtName"], status["courtName"]),
			"operatorUserId": firstString(event["operatorUserId"], status["operatorUserId"]),
			"operatorName":   firstString(event["operatorName"], status["operatorName"]),
		}),
		"createdAt": now,
		"updatedAt": now,
	}

	return liveDeviceEventEnvelope{
		source:     source,
		deviceID:   deviceID,
		occurredAt: occurredAt,
		level:      level,
		eventType:  eventType,
		reasonCode: reasonCode,
		reasonText: reasonText,
		status:     status,
		doc:        doc,
	}, true
}

func (s *service) persistLiveDeviceEventEnvelopes(c *gin.Context, envelopes []liveDeviceEventEnvelope) error {
	if len(envelopes) == 0 {
		return nil
	}

	docs := make([]any, 0, len(envelopes))
	for _, envelope := range envelopes {
		docs = append(docs, envelope.doc)
	}
	if _, err := s.events.InsertMany(c.Request.Context(), docs); err != nil {
		return err
	}

	for _, envelope := range envelopes {
		if envelope.deviceID == "" {
			continue
		}
		if err := s.updateLiveDeviceStateFromEvent(c, envelope); err != nil {
			return err
		}
	}
	return nil
}

func (s *service) updateLiveDeviceStateFromEvent(c *gin.Context, envelope liveDeviceEventEnvelope) error {
	now := time.Now().UTC()
	updateSet := bson.M{
		"source":              envelope.source,
		"deviceId":            envelope.deviceID,
		"capturedAt":          envelope.occurredAt,
		"lastSeenAt":          now,
		"receivedAt":          now,
		"expireAt":            buildExpireAt(s.cfg.LiveDeviceTTLDays, now),
		"lastEventType":       envelope.eventType,
		"lastEventLevel":      envelope.level,
		"lastEventReasonCode": envelope.reasonCode,
		"lastEventReasonText": envelope.reasonText,
		"lastEventAt":         envelope.occurredAt,
		"updatedAt":           now,
	}

	if len(envelope.status) > 0 {
		status := envelope.status
		route := firstObject(status["route"])
		stream := firstObject(status["stream"])
		recording := firstObject(status["recording"])
		overlay := firstObject(status["overlay"])
		app := firstObject(status["app"])
		thermal := firstObject(status["thermal"])
		battery := firstObject(status["battery"])
		network := firstObject(status["network"])
		match := firstObject(status["match"])
		court := firstObject(status["court"])
		operator := firstObject(status["operator"])

		updateSet["routeLabel"] = firstString(route["label"], status["routeLabel"])
		updateSet["screenState"] = firstString(status["screenState"])
		updateSet["streamState"] = firstString(stream["state"], status["streamState"])
		updateSet["overlayIssue"] = firstString(overlay["issue"], overlay["lastIssue"], status["overlayIssue"])
		updateSet["recoverySeverity"] = firstString(firstObject(status["recovery"])["severity"])
		updateSet["recoveryStage"] = firstString(firstObject(status["recovery"])["stage"])
		updateSet["matchId"] = firstString(match["id"], status["matchId"])
		updateSet["matchCode"] = firstString(match["code"], status["matchCode"])
		updateSet["courtId"] = firstString(court["id"], status["courtId"])
		updateSet["courtName"] = firstString(court["name"], status["courtName"])
		updateSet["operatorUserId"] = firstString(operator["userId"], status["operatorUserId"])
		updateSet["operatorName"] = firstString(operator["displayName"], status["operatorName"])
		updateSet["app"] = app
		updateSet["stream"] = stream
		updateSet["recording"] = recording
		updateSet["overlay"] = overlay
		updateSet["thermal"] = thermal
		updateSet["battery"] = battery
		updateSet["network"] = network
		updateSet["route"] = route
		updateSet["match"] = match
		updateSet["court"] = court
		updateSet["operator"] = operator
	}

	if strings.EqualFold(envelope.reasonCode, "app_crash_recovered") || strings.EqualFold(envelope.eventType, "app_crash_recovered") {
		updateSet["lastCrashRecoveredAt"] = envelope.occurredAt
		updateSet["lastCrashRecoveredReason"] = envelope.reasonText
	}

	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(envelope.eventType)), "app_") {
		updateSet["lastLifecycleEventType"] = envelope.eventType
		updateSet["lastLifecycleEventAt"] = envelope.occurredAt
		updateSet["lastLifecycleEventReason"] = envelope.reasonText
	}

	_, err := s.liveDevices.UpdateOne(
		c.Request.Context(),
		bson.M{"source": envelope.source, "deviceId": envelope.deviceID},
		bson.M{
			"$set": updateSet,
			"$setOnInsert": bson.M{
				"createdAt": now,
			},
		},
		options.Update().SetUpsert(true),
	)
	return err
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
	suspectedCrashCount := 0

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
		suspectedCrash, suspectedCrashReason, offlineForMs := detectUnexpectedDisconnect(row, now, lastSeenAt, staleAfterMs, isOnline)
		if suspectedCrash {
			suspectedCrashCount += 1
		}

		items = append(items, gin.H{
			"id":                       formatID(row["_id"]),
			"source":                   asString(row["source"]),
			"deviceId":                 asString(row["deviceId"]),
			"platform":                 asString(row["platform"]),
			"deviceName":               asString(row["deviceName"]),
			"deviceModel":              asString(row["deviceModel"]),
			"deviceManufacturer":       asString(row["deviceManufacturer"]),
			"deviceBrand":              asString(row["deviceBrand"]),
			"deviceProduct":            asString(row["deviceProduct"]),
			"operatorUserId":           asString(row["operatorUserId"]),
			"operatorName":             asString(row["operatorName"]),
			"operatorRole":             asString(row["operatorRole"]),
			"routeLabel":               asString(row["routeLabel"]),
			"screenState":              asString(row["screenState"]),
			"courtId":                  asString(row["courtId"]),
			"courtName":                asString(row["courtName"]),
			"matchId":                  asString(row["matchId"]),
			"matchCode":                asString(row["matchCode"]),
			"streamState":              asString(row["streamState"]),
			"overlayIssue":             asString(row["overlayIssue"]),
			"recoverySeverity":         asString(row["recoverySeverity"]),
			"recoveryStage":            asString(row["recoveryStage"]),
			"warningCount":             clampInt(parseInt(firstString(row["warningCount"]), 0), 0, 999),
			"heartbeatIntervalMs":      clampInt(parseInt(firstString(row["heartbeatIntervalMs"]), 10_000), 0, 120_000),
			"staleAfterMs":             staleAfterMs,
			"capturedAt":               row["capturedAt"],
			"lastSeenAt":               lastSeenAt,
			"isOnline":                 isOnline,
			"offlineForMs":             offlineForMs,
			"suspectedCrash":           suspectedCrash,
			"suspectedCrashReason":     suspectedCrashReason,
			"lastEventType":            asString(row["lastEventType"]),
			"lastEventLevel":           asString(row["lastEventLevel"]),
			"lastEventReasonCode":      asString(row["lastEventReasonCode"]),
			"lastEventReasonText":      asString(row["lastEventReasonText"]),
			"lastEventAt":              row["lastEventAt"],
			"lastCrashRecoveredAt":     row["lastCrashRecoveredAt"],
			"lastCrashRecoveredReason": asString(row["lastCrashRecoveredReason"]),
			"app":                      firstObject(row["app"]),
			"device":                   firstObject(row["device"]),
			"operator":                 firstObject(row["operator"]),
			"route":                    firstObject(row["route"]),
			"court":                    firstObject(row["court"]),
			"match":                    firstObject(row["match"]),
			"stream":                   firstObject(row["stream"]),
			"recording":                firstObject(row["recording"]),
			"overlay":                  firstObject(row["overlay"]),
			"presence":                 firstObject(row["presence"]),
			"network":                  firstObject(row["network"]),
			"battery":                  firstObject(row["battery"]),
			"thermal":                  firstObject(row["thermal"]),
			"recovery":                 firstObject(row["recovery"]),
			"warnings":                 normalizeStringList(row["warnings"]),
			"diagnostics":              normalizeStringList(row["diagnostics"]),
			"payload":                  firstObject(row["payload"]),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ok": true,
		"counts": gin.H{
			"total":              len(items),
			"online":             onlineCount,
			"live":               liveCount,
			"overlayIssues":      overlayIssueCount,
			"criticalRecoveries": criticalCount,
			"suspectedCrashes":   suspectedCrashCount,
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
		"suspectedCrashes":   0,
	}
	for _, row := range rows {
		lastSeenAt := parseTime(firstNonNil(row["lastSeenAt"], row["capturedAt"]))
		staleAfterMs := clampInt(parseInt(firstString(row["staleAfterMs"]), s.cfg.LiveDeviceStaleMs), 5_000, 10*60*1000)
		isOnline := now.Sub(lastSeenAt) <= time.Duration(staleAfterMs)*time.Millisecond
		suspectedCrash, suspectedCrashReason, _ := detectUnexpectedDisconnect(row, now, lastSeenAt, staleAfterMs, isOnline)
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
		if suspectedCrash {
			counts["suspectedCrashes"] = counts["suspectedCrashes"].(int) + 1
		}
		items = append(items, gin.H{
			"deviceId":             asString(row["deviceId"]),
			"deviceName":           asString(row["deviceName"]),
			"deviceModel":          asString(row["deviceModel"]),
			"deviceManufacturer":   asString(row["deviceManufacturer"]),
			"deviceBrand":          asString(row["deviceBrand"]),
			"deviceProduct":        asString(row["deviceProduct"]),
			"operatorName":         asString(row["operatorName"]),
			"courtName":            asString(row["courtName"]),
			"matchCode":            asString(row["matchCode"]),
			"streamState":          asString(row["streamState"]),
			"overlayIssue":         asString(row["overlayIssue"]),
			"recoverySeverity":     asString(row["recoverySeverity"]),
			"lastSeenAt":           lastSeenAt,
			"isOnline":             isOnline,
			"suspectedCrash":       suspectedCrash,
			"suspectedCrashReason": suspectedCrashReason,
		})
	}
	return gin.H{
		"counts": counts,
		"items":  items,
	}
}

func detectUnexpectedDisconnect(row bson.M, now, lastSeenAt time.Time, staleAfterMs int, isOnline bool) (bool, string, int64) {
	offlineForMs := now.Sub(lastSeenAt).Milliseconds()
	if isOnline {
		return false, "", offlineForMs
	}
	if offlineForMs < int64(maxInt(staleAfterMs*2, 20_000)) {
		return false, "", offlineForMs
	}

	streamState := strings.ToLower(firstString(row["streamState"], firstObject(row["stream"])["state"]))
	recordingState := strings.ToLower(firstString(firstObject(row["recording"])["stateText"]))
	route := firstObject(row["route"])
	overlay := firstObject(row["overlay"])
	matchID := firstString(row["matchId"], firstObject(row["match"])["id"])
	appActive := asBool(route["appIsActive"])
	liveLike := streamState == "live" || streamState == "connecting" || streamState == "reconnecting"
	recordingBusy := strings.Contains(recordingState, "ghi") || strings.Contains(recordingState, "record")
	if !liveLike && !recordingBusy && !(appActive && matchID != "") {
		return false, "", offlineForMs
	}

	reason := "heartbeat_timeout_while_live"
	if firstString(row["overlayIssue"], overlay["issue"]) != "" {
		reason = "heartbeat_timeout_after_overlay_issue"
	}
	return true, reason, offlineForMs
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

func asBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		default:
			return false
		}
	case int:
		return typed != 0
	case int32:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return false
	}
}
