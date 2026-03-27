const fs = require('fs');
const file = 'pickletour-app-mobile/components/match/RefereeScorePanel.native.tsx';
let txt = fs.readFileSync(file, 'utf8');

// Patch 1: NameBadge sub-container
txt = txt.replace(
  '<View style={{ position: "relative", marginTop: 6 }}>',
  '<View style={{ position: "relative", marginTop: 6, maxWidth: "100%" }}>'
);

// Patch 2: TeamBox inner container
txt = txt.replace(
  '<View\n          style={{ alignItems: "center", justifyContent: "center", gap: 8 }}',
  '<View\n          style={{ alignItems: "center", justifyContent: "center", gap: 8, maxWidth: "100%" }}'
);
// Fallback if formatting was different
txt = txt.replace(
  '<View style={{ alignItems: "center", justifyContent: "center", gap: 8 }}>',
  '<View style={{ alignItems: "center", justifyContent: "center", gap: 8, maxWidth: "100%" }}>'
);

fs.writeFileSync(file, txt);
console.log('Fixed wrapper bounds');
