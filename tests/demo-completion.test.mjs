import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const url = (path, replace = []) => {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of replace) source = source.replace(from, to);
  return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
};
const { readCompletedScenarioIds, recordCompletedScenario } = await import(url('../src/lib/completedScenarios.ts'));
const { buildReportTranscript } = await import(url('../src/lib/reportTranscript.ts', [['"./chatErrors"', JSON.stringify(url('../src/lib/chatErrors.ts'))]]));
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value)};
}
test('legacy page-visit counts do not become completed sessions', () => {
  assert.deepEqual(readCompletedScenarioIds(storage({numScenariosCompleted:'99'})), []);
});
test('successful session is counted once across retries and rereads', () => {
  const store=storage();
  recordCompletedScenario(store,'session-a'); recordCompletedScenario(store,'session-a');
  assert.deepEqual(readCompletedScenarioIds(store),['session-a']);
  recordCompletedScenario(store,'session-b');
  assert.deepEqual(readCompletedScenarioIds(store),['session-a','session-b']);
});
test('invalid storage is safe and failed writes remain failures', () => {
  assert.deepEqual(readCompletedScenarioIds({getItem:()=>'{broken'}),[]);
  assert.deepEqual(readCompletedScenarioIds({getItem:()=>{throw Error('denied')}}),[]);
  assert.throws(()=>recordCompletedScenario({getItem:()=>null,setItem:()=>{throw Error('quota')}},'session'));
});
test('empty, system-only and failed conversations cannot generate reports', () => {
  const user={type:'text',role:'user',content:'How can I help?'};
  for(const messages of [[],[user],[user,{type:'text',role:'bot',content:'An error occurred while sending your message.'}],[user,{type:'error',role:'bot',content:'failure'}],[user,{type:'text',role:'system',content:'instructions'}]]) assert.equal(buildReportTranscript(messages),null);
});
test('report transcript includes dialogue and excludes failures and tool output', () => {
  assert.equal(buildReportTranscript([
    {type:'text',role:'user',content:'How can I help?'},
    {type:'text',role:'bot',content:'An error occurred while sending your message.'},
    {type:'tool-result',role:'assistant',content:'hidden'},
    {type:'text',role:'assistant',content:'I need clearer priorities.'},
  ]),'user: How can I help?\nbart: I need clearer priorities.');
});

test('a partial assistant turn from a failed stream is not a completed conversation', () => {
  assert.equal(buildReportTranscript([
    {type:'text',role:'user',content:'How can I help?'},
    {type:'text',role:'assistant',content:'Partial reply',metadata:{generationFailed:true}},
    {type:'error',role:'bot',content:'failure'},
  ]),null);
});
