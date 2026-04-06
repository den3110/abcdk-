const fs = require('fs');
const p = 'admin-pickletour/src/layouts/SystemSettingsPage.jsx';
let f = fs.readFileSync(p, 'utf8');

// The output of PowerShell get-content looked like:
// <style>{.picker-dialog { z-index: 99999 !important; } .picker-dialog-bg { z-index: 99998 !important; }}</style>\n      <DashboardNavbar />
// We'll replace any mess around DashboardNavbar back to the clean version, then add pure html style block: `<style dangerouslySetInnerHTML={{__html: '.picker-dialog { z-index: 99999 !important; } .picker-dialog-bg { z-index: 99998 !important; }'}} />`

f = f.replace(/<style>\{.*?\}<\/style>/g, '');
f = f.replace(/\\n\s*<DashboardNavbar \/>/g, '<DashboardNavbar />');
f = f.replace(/<DashboardNavbar \/>/g, '<DashboardNavbar />');

// Now, we uniquely inject the clean style if not present.
if (!f.includes('.picker-dialog-bg {')) {
  f = f.replace(/<DashboardNavbar \/>/g, '<style dangerouslySetInnerHTML={{__html: `.picker-dialog { z-index: 99999 !important; } .picker-dialog-bg { z-index: 99998 !important; }`}} />\n      <DashboardNavbar />');
}

fs.writeFileSync(p, f);
console.log('Done fix2');
