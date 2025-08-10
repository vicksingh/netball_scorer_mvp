const fs = require("fs");
const path = require("path");

const p = path.join(process.cwd(), "app", "globals.css");
if (!fs.existsSync(p)) {
  console.error("ERROR: Missing required file app/globals.css (imported by app/layout.tsx).");
  process.exit(1);
} else {
  console.log("ok: app/globals.css present");
}
