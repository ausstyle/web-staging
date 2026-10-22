import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 19000 + Math.floor(Math.random() * 1000);
const base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: process.cwd(),
  env: {...process.env, PORT:String(port)},
  stdio:"ignore"
});
async function waitForServer() {
  for(let attempt=0;attempt<40;attempt++){
    try{const r=await fetch(base+"/healthz");if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error("server_not_started");
}
test("Health endpoint and MCP authentication boundaries", async (t)=>{
  t.after(()=>child.kill("SIGTERM"));
  await waitForServer();
  const health=await fetch(base+"/healthz");
  assert.equal(health.status,200);
  const noAuth=await fetch(base+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
  assert.equal(noAuth.status,401);
  const malformed=await fetch(base+"/mcp",{method:"POST",headers:{"authorization":"Bearer bad token","content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/list"})});
  assert.equal(malformed.status,401);
  const forbiddenMethod=await fetch(base+"/mcp",{method:"GET"});
  assert.equal(forbiddenMethod.status,405);
  const mediaEnvelope=await fetch(base+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"gcp.storage.objects.upload.media",arguments:{content_base64:"AAAA".repeat(349525)+"AA=="}}})});
  assert.equal(mediaEnvelope.status,401,"one MiB base64 envelope reaches authentication rather than the parser limit");
  const overflow=await fetch(base+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content_base64:"x".repeat(1550000)})});
  assert.equal(overflow.status,413);
});
