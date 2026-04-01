const fs = require('fs');

const extractAndFix = (file) => {
  let content = fs.readFileSync(file, 'utf8');
  const regex = /\\u([0-9a-fA-F]{4})/g;
  let matches = 0;
  content = content.replace(regex, (match, grp) => {
    matches++;
    return String.fromCharCode(parseInt(grp, 16));
  });
  if (matches > 0) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Fixed ${matches} unicode escapes in ${file}`);
  } else {
    console.log(`No unicode escapes found in ${file}`);
  }
};

extractAndFix('pickletour-app-mobile/components/chatbot/ChatAssistant.jsx');
extractAndFix('frontend/src/components/ChatBotDrawer.jsx');
