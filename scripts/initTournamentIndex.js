// scripts/initTournamentIndex.js
import { es, ES_TOURNAMENT_INDEX } from "../backend/services/esClient.js";

async function initTournamentIndex() {
  const exists = await es.indices.exists({ index: ES_TOURNAMENT_INDEX });

  if (exists) {
    console.log(`Index ${ES_TOURNAMENT_INDEX} đã tồn tại, skip tạo mới.`);
    return;
  }

  await es.indices.create({
    index: ES_TOURNAMENT_INDEX,
    settings: {
      analysis: {
        analyzer: {
          // Analyzer đơn giản: lowercase cho text
          default: {
            type: "standard",
            stopwords: "_none_",
          },
        },
      },
    },
    mappings: {
      properties: {
        name:         { type: "text" },
        code:         { type: "keyword" },
        location:     { type: "text", fields: { keyword: { type: "keyword" } } },
        status:       { type: "keyword" },
        sportType:    { type: "integer" },
        groupId:      { type: "integer" },

        image:        { type: "keyword" },
        eventType:    { type: "keyword" },
        timezone:     { type: "keyword" },

        regOpenDate:          { type: "date" },
        registrationDeadline: { type: "date" },
        startDate:            { type: "date" },
        endDate:              { type: "date" },
        startAt:              { type: "date" },
        endAt:                { type: "date" },

        scoringScopeType:      { type: "keyword" },
        scoringScopeProvinces: { type: "keyword" },

        "locationGeo.lat": { type: "double" },
        "locationGeo.lon": { type: "double" },

        searchText: { type: "text" },

        createdAt: { type: "date" },
        updatedAt: { type: "date" },
      },
    },
  });

  console.log(`✅ Created index ${ES_TOURNAMENT_INDEX}`);
}

initTournamentIndex()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("initTournamentIndex error:", err);
    process.exit(1);
  });
