const fs = require('fs');

const p = 'admin-pickletour/src/layouts/SystemSettingsPage.jsx';
let f = fs.readFileSync(p, 'utf8');

// Inject global CSS for Picker dialog
if (!f.includes(' picker-dialog-bg')) {
  f = f.replace(/<DashboardNavbar \/>/g, '<style>{`\\n        .picker-dialog {\\n          z-index: 99999 !important;\\n        }\\n        .picker-dialog-bg {\\n          z-index: 99998 !important;\\n        }\\n      `}</style>\\n      <DashboardNavbar />');
}

// Remove setSize
f = f.replace(/\.setSize\(\d+,\s*\d+\)/g, '');

fs.writeFileSync(p, f);
console.log('Done!');
