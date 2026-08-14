import app from "../.vercel/output/functions/__server.func/index.mjs";

async function test() {
  const req = new Request("http://127.0.0.1:8080/", { headers: { accept: "text/html" } });
  const res = await app.fetch(req);
  console.log("Status:", res.status);
  console.log("Headers:", Object.fromEntries(res.headers.entries()));
  const html = await res.text();
  console.log("HTML length:", html.length);
  console.log("HTML snippet:", html.slice(0, 300));
}

test().catch(console.error);
