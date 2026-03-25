const fs = require('fs');

function fixTheme(file) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');

    // Make sure alpha is imported
    if (!content.includes('alpha,')) {
        content = content.replace('} from "@mui/material";', '  alpha,\n} from "@mui/material";');
    }

    // Fix grey.50 and grey.100
    content = content.split('bgcolor: "grey.50"').join('bgcolor: "background.default"');
    content = content.split('bgcolor: "grey.100"').join('bgcolor: "background.default"');
    
    // Fix Stat in TournamentCourtClusterDialog.jsx
    if (content.includes('function Stat({')) {
        const statBefore = `function Stat({ label, value, tone = "default" }) {
  const bg = { default: "grey.100", success: "success.light", warning: "warning.light", info: "info.light" }[tone] || "grey.100";
  return <Paper variant="outlined" sx={{ minWidth: 112, px: 1.5, py: 1.25, borderRadius: 2, bgcolor: bg }}><Typography variant="caption">{label}</Typography><Typography variant="h6" fontWeight={800}>{value}</Typography></Paper>;
}`;
        
        const statAfter = `function Stat({ label, value, tone = "default" }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        minWidth: 112,
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        bgcolor: (theme) => tone === "default" ? "background.default" : alpha(theme.palette[tone].main, 0.1),
        borderColor: (theme) => tone !== "default" ? alpha(theme.palette[tone].main, 0.3) : "divider",
        color: tone !== "default" ? \`\${tone}.main\` : "text.primary"
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Typography variant="h6" fontWeight={800}>{value}</Typography>
    </Paper>
  );
}`;
        content = content.replace(statBefore, statAfter);
        
        // Let's also do a general regex replace in case spacing is slightly different
        content = content.replace(
            /function Stat\(\{ label, value, tone = "default" \}\) \{[\s\S]*?return <Paper[^>]*>.*?<\/Paper>;\s*\}/g,
            statAfter
        );
    }
    
    // In AssignCourtStationDialog, check if there's any paper with grey.50
    const paper50Regex = /<Paper variant="outlined" sx=\{\{([^}]*)bgcolor:\s*"grey\.50"([^}]*)\}\}>/g;
    content = content.replace(paper50Regex, '<Paper variant="outlined" sx={{$1bgcolor: "background.default"$2}}>');
    
    // Wait, I already did global replace:
    // content = content.split('bgcolor: "grey.50"').join('bgcolor: "background.default"');
    
    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed theme in", file);
}

fixTheme('frontend/src/components/TournamentCourtClusterDialog.jsx');
fixTheme('frontend/src/components/AssignCourtStationDialog.jsx');
