const fs = require('fs');

function fixTheme(file) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');

    // Make sure alpha is imported
    if (!content.includes('alpha,')) {
        content = content.replace('from "@mui/material";', 'alpha,\n} from "@mui/material";');
    }

    // Fix grey.50 and grey.100 inside bgcolors
    content = content.replace(/bgcolor: "grey\.50"/g, 'bgcolor: "background.default"');
    content = content.replace(/bgcolor: "grey\.100"/g, 'bgcolor: "background.default"');

    // Fix the Stat component in TournamentCourtClusterDialog
    content = content.replace(
        /const bg = \{ default: "[^"]+", success: "[^"]+", warning: "[^"]+", info: "[^"]+" \}.*?;/g,
        ''
    );

    // Completely replace the Stat component function if it exists
    if (content.includes('function Stat({')) {
        content = content.replace(
            /function Stat\(\{ label, value, tone = "default" \}\) \{[\s\S]*?return <Paper[^>]*>.*?<\/Paper>;\s*\}/g,
            `function Stat({ label, value, tone = "default" }) {
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
}`
        );
    }

    // Fix hardcoded Chip colored variants if they don't look good in dark mode
    // Actually standard MUI Chips handle dark mode fine if they are color="warning" or color="info".

    fs.writeFileSync(file, content, 'utf8');
    console.log("Fixed theme in " + file);
}

fixTheme('frontend/src/components/TournamentCourtClusterDialog.jsx');
fixTheme('frontend/src/components/AssignCourtStationDialog.jsx');
