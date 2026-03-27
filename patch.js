const fs = require('fs');
const file = 'pickletour-app-mobile/components/match/RefereeScorePanel.native.tsx';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('flexShrink: 1')) {
  code = code.replace(
    /nickText: \{ fontSize: 14, fontWeight: "800", color: "#0f172a" \}/g, 
    'nickText: { fontSize: 14, fontWeight: "800", color: "#0f172a", flexShrink: 1 }'
  );
  
  code = code.replace(
    /fullNameText: \{ fontSize: 16, fontWeight: "800", color: "#0f172a" \}/g,
    'fullNameText: { fontSize: 16, fontWeight: "800", color: "#0f172a", flexShrink: 1, textAlign: "center" }'
  );

  code = code.replace(
    /badgeName: {[\s\S]*?borderColor: "#e5e7eb",\r?\n  },/,
    match => match.replace('},', '  maxWidth: "100%",\n  },')
  );

  fs.writeFileSync(file, code);
  console.log('Patched');
} else {
  console.log('Already patched');
}
