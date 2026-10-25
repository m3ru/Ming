import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}});
  const result={exports:{}};
  new Function('require','module','exports',outputText)((id)=>Object.hasOwn(mocks,id)?mocks[id]:require(id),result,result.exports);
  return result.exports;
}
Object.assign(process.env,{
 MING_BACKEND_TOKEN:'test-backend-token-not-for-production-12345',
 MING_APP_ORIGIN:'https://ming.example',
 MING_BACKEND_URL:'http://127.0.0.1:4111',
});
const security=load('src/lib/server/security.ts');
const mock={'@/lib/server/security':security};
const proxy=load('src/app/api/backend/[...path]/route.ts',mock);
const config=security.securityConfig(new Request('https://ming.example'));
function request(path,body={},headers={}) {
 return new Request('https://ming.example'+path,{method:'POST',headers:{origin:config.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
const context=path=>({params:Promise.resolve({path:path.split('/')})});
test('localhost needs no login, password, session secret or configured origin',()=>{
 delete process.env.MING_APP_ORIGIN;
 try {
  for(const host of ['localhost','127.0.0.1','[::1]']) {
   const local=new Request(`http://${host}:3000/api/backend/chat/stream`);
   assert.equal(security.securityConfig(local).origin,`http://${host}:3000`);
  }
  const normalized=new Request('http://localhost:3000/api/backend/chat/stream',{headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}});
  security.requireSameOrigin(normalized,security.securityConfig(normalized));
  assert.throws(()=>security.securityConfig(new Request('http://localhost:3000',{headers:{host:'external.example'}})));
  assert.throws(()=>security.securityConfig(new Request('https://external.example/api/backend/chat/stream')));
 }finally{process.env.MING_APP_ORIGIN=config.origin;}
});
test('cross-origin requests fail before upstream fetch',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('unexpected')};
 try{
  for(const headers of [{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},{origin:''}])assert.equal((await proxy.POST(request('/api/backend/chat/stream',{},headers),context('chat/stream'))).status,403);
  assert.equal(calls,0);
 }finally{global.fetch=original;}
});
test('proxy denies framework APIs and path escapes without a login',async()=>{
 for(const path of ['api/memory/threads','api/workflows/run','../chat/stream','chat/stream?x=1','https://evil.example'])assert.equal((await proxy.POST(request('/api/backend/'+path),context(path))).status,404);
});
test('cookie-free demo requests work; gateway ignores forged identity and hides internal credentials',async()=>{
 const original=global.fetch;let sent;
 global.fetch=async(url,init)=>{sent={url:String(url),...init};return new Response('data: hello\n\n',{headers:{'Content-Type':'text/event-stream','Set-Cookie':'bad=secret','x-ming-gateway-token':'secret'}})};
 try{
  const response=await proxy.POST(request('/api/backend/chat/stream',{prompt:'hello'},{'x-ming-user-id':'victim','x-ming-gateway-token':'forged',authorization:'Bearer arbitrary'}),context('chat/stream'));
  assert.equal(response.status,200);assert.equal(await response.text(),'data: hello\n\n');
  assert.equal(sent.headers['x-ming-user-id'],'localhost-demo');
  assert.equal(sent.headers['x-ming-gateway-token'],config.gatewayToken);
  assert.equal(sent.headers['Content-Type'],'application/ming+json');
  assert.equal(sent.headers.Authorization,undefined);assert.equal(sent.redirect,'error');
  assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-ming-gateway-token'),null);
 }finally{global.fetch=original;}
});
test('byte and validation budgets reject hostile input before downstream schema work',async()=>{
 await assert.rejects(security.boundedBody(request('/test',{text:'x'.repeat(262144)})),{status:413});
 assert.throws(()=>security.validateJsonBudget(JSON.stringify(Array(257).fill(0))),{status:413});
 assert.throws(()=>security.validateJsonBudget('['.repeat(22)+'0'+']'.repeat(22)),{status:413});
 assert.throws(()=>security.validateJsonBudget('{"__proto__":{}}'),{status:400});
 assert.throws(()=>security.validateJsonBudget(JSON.stringify(Array(256).fill(Array(20).fill(0)))),{status:413});
 security.validateJsonBudget(JSON.stringify({prompt:'hello',messages:Array(128).fill({role:'user',content:'hello'})}));
});

test('only the Deepgram turn route allows a bounded audio payload above the normal JSON limit',async()=>{
 const original=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;return Response.json({status:'success'});};
 try{
  const audio={audioBase64:'A'.repeat(300000),threadId:'test',turnId:'test'};
  assert.equal((await proxy.POST(request('/api/backend/voice/deepgram/turn',audio),context('voice/deepgram/turn'))).status,200);
  assert.equal((await proxy.POST(request('/api/backend/chat/stream',audio),context('chat/stream'))).status,413);
  assert.equal((await proxy.POST(request('/api/backend/voice/deepgram/turn',{audioBase64:'A'.repeat(2*1024*1024)}),context('voice/deepgram/turn'))).status,413);
  assert.equal(calls,1);
 }finally{global.fetch=original;}
});

test('Deepgram turn and speech responses stream through POST-only with their content types',async()=>{
 const original=global.fetch;const sent=[];
 global.fetch=async(url,init)=>{sent.push({url:String(url),...init});return String(url).endsWith('/speech')?new Response('mp3 bytes',{headers:{'Content-Type':'audio/mpeg'}}):new Response('{"type":"done"}\n',{headers:{'Content-Type':'application/x-ndjson'}});};
 try{
  const turn=await proxy.POST(request('/api/backend/voice/deepgram/turn',{turnId:'t'}),context('voice/deepgram/turn'));
  assert.equal(turn.headers.get('content-type'),'application/x-ndjson');assert.equal(await turn.text(),'{"type":"done"}\n');
  const speech=await proxy.POST(request('/api/backend/voice/deepgram/speech',{turnId:'t',threadId:'x'}),context('voice/deepgram/speech'));
  assert.equal(speech.status,200);assert.equal(speech.headers.get('content-type'),'audio/mpeg');assert.equal(await speech.text(),'mp3 bytes');
  assert.equal(sent[1].url,'http://127.0.0.1:4111/voice/deepgram/speech');assert.equal(sent[1].headers['x-ming-user-id'],'localhost-demo');
  assert.equal(proxy.GET,undefined);
  assert.equal((await proxy.POST(request('/api/backend/voice/deepgram/speech',{},{origin:'https://evil.example'}),context('voice/deepgram/speech'))).status,403);
  assert.equal((await proxy.POST(request('/api/backend/voice/deepgram/speech',{pad:'x'.repeat(300000)}),context('voice/deepgram/speech'))).status,413);
  assert.equal(sent.length,2);
 }finally{global.fetch=original;}
});

test('voice selection defaults to OpenAI Live and supports explicit Deepgram without silently accepting typos',()=>{
 const {resolveVoiceProvider}=load('src/lib/voiceProvider.ts');
 assert.equal(resolveVoiceProvider(),'openai');
 assert.equal(resolveVoiceProvider(''),'openai');
 assert.equal(resolveVoiceProvider(' Deepgram '),'deepgram');
 assert.equal(resolveVoiceProvider('openai'),'openai');
 assert.throws(()=>resolveVoiceProvider('gemini'));
});

test('voice lease heartbeat and release retain their capability through the gateway',async()=>{
 const original=global.fetch;const calls=[];
 global.fetch=async(url,init)=>{calls.push({url:String(url),...init});return Response.json({ok:true});};
 try{
  for(const action of ['heartbeat','end']){
   const path=`voice/${action}`;
   const response=await proxy.POST(request(`/api/backend/${path}`,{sessionId:'live-recovery'},{authorization:'Bearer recovery-capability','x-ming-user-id':'forged'}),context(path));
   assert.equal(response.status,200);
   const sent=calls.at(-1);
   assert.equal(sent.url,`http://127.0.0.1:4111/${path}`);
   assert.equal(sent.headers.Authorization,'Bearer recovery-capability');
   assert.equal(sent.headers['x-ming-user-id'],'localhost-demo');
   assert.deepEqual(JSON.parse(sent.body),{sessionId:'live-recovery'});
  }
 }finally{global.fetch=original;}
});
