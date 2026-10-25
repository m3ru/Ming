// Run after both production builds. Test credentials are synthetic and temporary.
// No provider credentials or external model calls are used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cpSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=mkdtempSync(join(tmpdir(),'ming-security-'));
const origin='http://127.0.0.1:43100';
const backend='http://127.0.0.1:44119';
const env={...process.env,NODE_ENV:'production',MING_BACKEND_URL:backend,MING_BACKEND_TOKEN:'synthetic-backend-token-01234567890123456789',MING_DATABASE_URL:'file:'+join(data,'memory.db'),MASTRA_DEFAULT_STORAGE_URL:'file:'+join(data,'mastra.db')};
delete env.MING_APP_ORIGIN;delete env.MING_ACCESS_PASSWORD;delete env.MING_SESSION_SECRET;delete env.OPENAI_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.DEEPGRAM_API_KEY;
  env.MING_TEXT_PROVIDER = "gemini";
  env.MING_VOICE_PROVIDER = process.argv.includes('--deepgram') ? 'deepgram' : 'openai';delete env.MASTRA_CLOUD_ACCESS_TOKEN;
const children=[];
const diagnostics=[];
function start(args,cwd,extra,marker,readyUrl){
 const child=spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:['ignore','pipe','pipe']});
 const closed=once(child,'close');children.push({child,closed});
 return new Promise((resolve,reject)=>{
  let log='';let settled=false;let probe;const finish=()=>{settled=true;clearTimeout(deadline);clearInterval(probe);resolve(child)};
  const deadline=setTimeout(()=>{settled=true;clearInterval(probe);reject(Error('Server did not become ready: '+log.slice(-1000)))},30000);
  if(readyUrl) probe=setInterval(()=>{void fetch(readyUrl,{signal:AbortSignal.timeout(500)}).then(response=>{if(!settled && response.status===401)finish()}).catch(()=>{})},200);
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log+=chunk;diagnostics.push(String(chunk));if(marker && log.includes(marker) && !settled)finish()});
  closed.then(([code])=>{settled=true;clearInterval(probe);clearTimeout(deadline);reject(Error('Server exited '+code+': '+log.slice(-1000)))});
 });
}
const post=(path,body={},headers={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',origin,...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
try{
 // Match the Docker frontend artifact and command without relying on repository dependencies.
 const frontend=join(data,'frontend');
 cpSync(join(root,'.next/standalone'),frontend,{recursive:true});
 cpSync(join(root,'.next/static'),join(frontend,'.next/static'),{recursive:true});
 cpSync(join(root,'public'),join(frontend,'public'),{recursive:true});
 await start(['.mastra/output/index.mjs'],join(root,'src/backend'),{PORT:'44119'},null,backend);
 await start(['server.js'],frontend,{HOSTNAME:'127.0.0.1',PORT:'43100'},'Ready in');
 let response=await fetch(origin);const html=await response.text();
 assert.match(html,/Welcome back/);assert.ok(!html.includes("Presenter access"));assert.ok(!html.includes(env.MING_BACKEND_TOKEN));
 assert.ok(!html.includes("Sign out"));
 assert.equal((await post('/api/auth/login',{})).status,404);
 assert.equal((await post('/api/auth/logout',{})).status,404);
 assert.equal(response.headers.get('x-frame-options'),'DENY');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const assets=[...html.matchAll(/(?:src|href)="([^\"]*\/_next\/static\/[^\"]+)"/g)].map(match=>match[1]);
 assert.ok(assets.length>0);
 for(const asset of new Set(assets))assert.equal((await fetch(new URL(asset,origin))).status,200,'Missing standalone asset: '+asset);
 assert.equal((await fetch(backend+'/api/memory/threads?agentId=defaultAgent')).status,401);
 const internal={'x-ming-gateway-token':env.MING_BACKEND_TOKEN,'x-ming-user-id':'synthetic-owner'};
 for(const path of ['/api/memory/threads?agentId=defaultAgent','/api/memory/threads/synthetic/messages?agentId=defaultAgent','/api/agents','/api/workflows'])assert.equal((await fetch(backend+path,{headers:internal})).status,404);
 assert.equal((await post('/api/backend/chat/stream',{prompt:'synthetic',threadId:'synthetic'},{origin:'https://evil.example'})).status,403);
 assert.equal((await post('/api/backend/api/memory/threads',{})).status,404);
 assert.equal((await post('/api/backend/chat/stream',{prompt:'x'.repeat(270000)})).status,413);
 assert.equal((await post('/api/backend/chat/stream',{nested:Array(300).fill(0)})).status,413);
 for(let i=0;i<2;i++){
  response=await post('/api/backend/chat/stream',{prompt:'synthetic missing-key smoke',threadId:'synthetic-thread'});
  assert.equal(response.status,503);assert.equal((await response.json()).code,'AI_NOT_CONFIGURED');
 }
 response=await post('/api/backend/voice/deepgram/turn',{
  turnId:'12345678-1234-4234-8234-123456789012',threadId:'synthetic-deepgram-thread',
  audioBase64:Buffer.from('keyless audio boundary check').toString('base64'),mimeType:'audio/webm',
  context:{},messages:[],
 });
 assert.equal(response.status,env.MING_VOICE_PROVIDER==='deepgram'?503:404,'Deepgram selection must reach the configured backend boundary');
 response=await fetch(origin);assert.match(await response.text(),/Welcome back/);
 console.log('PASS ('+env.MING_VOICE_PROVIDER+' voice): login-free built standalone demo + Mastra: direct home access, static assets, no credential leakage, security headers, private backend denial, blocked framework APIs, cross-origin rejection, input limits, two recoverable cookie-free 503s, Deepgram configuration boundary. No provider call.');
}catch(error){
 console.error('Built server diagnostics:', diagnostics.join('').slice(-6000));
 throw error;
}finally{
 for(const {child}of children)if(child.exitCode===null)child.kill('SIGTERM');
 await Promise.all(children.map(({closed})=>closed));rmSync(data,{recursive:true,force:true});
}
