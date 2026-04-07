import fs from 'fs';
const controllersDir = 'c:/Users/giang/code/mern-auth/backend/controllers/';

let radarPath = controllersDir + 'radarController.js';
if (fs.existsSync(radarPath)) {
  let content = fs.readFileSync(radarPath, 'utf8');
  if (!content.includes('shouldHideUserRatings')) {
    content = content.replace(/import .*? from "\.\.\/models\/.*?\n/, "$&\nimport { shouldHideUserRatings, sanitizeRatingsObj } from '../utils/privacyControl.js';\n");
  }
  // modify getNearbyPlayers
  if(content.includes('enriched.sort((a, b) => b.score - a.score || a.distance - b.distance);\n\n  res.json({')){
      content = content.replace('enriched.sort((a, b) => b.score - a.score || a.distance - b.distance);\n\n  res.json({', 
      'enriched.sort((a, b) => b.score - a.score || a.distance - b.distance);\n  let isHiddenInfo = false;\n  if(typeof shouldHideUserRatings === "function") {\n      isHiddenInfo = await shouldHideUserRatings(req.user, null);\n  }\n  if (isHiddenInfo) {\n      enriched.forEach(p => {\n          p.ratingSingles = 0;\n          p.ratingDoubles = 0;\n          p.rating = 0;\n      });\n  }\n\n  res.json({');
      console.log('patched getNearbyPlayers in radar');
  }
  // modify getRadarExplore
  if(content.includes('const safeItems = items.filter((it) => isValidPoint(it?.location));\n\n  res.json({')){
      content = content.replace('const safeItems = items.filter((it) => isValidPoint(it?.location));\n\n  res.json({', 
      'const safeItems = items.filter((it) => isValidPoint(it?.location));\n  let isHiddenInfoItems = false;\n  if(typeof shouldHideUserRatings === "function") {\n      isHiddenInfoItems = await shouldHideUserRatings(req.user, null);\n  }\n  if (isHiddenInfoItems) {\n      safeItems.forEach(p => {\n          if (p.type === "user") {\n             p.rating = 0;\n          }\n      });\n  }\n\n  res.json({');
      console.log('patched getRadarExplore in radar');
  }
  
  fs.writeFileSync(radarPath, content);
}
