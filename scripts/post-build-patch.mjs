import fs from "node:fs";
import path from "node:path";

const ssrDir = path.resolve(".vercel/output/functions/__server.func/_ssr");

if (fs.existsSync(ssrDir)) {
  const files = fs.readdirSync(ssrDir).filter((f) => f.startsWith("face-api") && f.endsWith(".mjs"));
  for (const file of files) {
    const filePath = path.join(ssrDir, file);
    let content = fs.readFileSync(filePath, "utf-8");
    if (content.includes("this.textEncoder = new this.util.TextEncoder()")) {
      content = content.replace(
        "this.textEncoder = new this.util.TextEncoder()",
        'this.textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null',
      );
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`[Build Patch] Patched zO TextEncoder in ${file}`);
    }
  }
}
