import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=resolve(process.argv[2]);
const require=createRequire(join(root,'frontend/package.json'));
const ts=require('typescript');
const modules=new Map();
function compiled(name) {
 if(modules.has(name)) return modules.get(name);
 const source=readFileSync(join(root,'frontend/src',name+'.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','exports','module',code)(id=>id.startsWith('./')?compiled(id.slice(2)):require(id),module.exports,module);
 modules.set(name,module.exports);return module.exports;
}
const { normalizeEvent,normalizeEvents,normalizeEvaluation }=compiled('adapter');
const event={id:'review-event',timestamp:'2026-10-04T02:00:00+02:00',category:'market_public',decision:'ALLOW',policy:'market_public',reason:'ordinary synthetic text',latency_ms:1};
const evaluation={decision:'ALLOW',policy:'market_public',reason:'ordinary synthetic text',event_id:'review-event',latency_ms:1};
const rows=[];
function challenge(name,fn,shouldReject=true) {
 let rejected=false,sanitized=false;
 try { fn(); } catch(error) { rejected=true;sanitized=error.message==='Backend contract error: response does not match docs/API_CONTRACT.md.'; }
 rows.push({name,rejected,sanitized,passed:rejected===shouldReject&&(!rejected||sanitized)});
}
challenge('nested-array-case-hyphen-secret-field',()=>normalizeEvents({events:[{...event,extras:[{deep:{'Access--Token':'SYNTHETIC_PRIVATE'}}]}]}));
challenge('unicode-escaped-credential-key',()=>normalizeEvent({...event,...JSON.parse('{"\\u0063redential":"SYNTHETIC_PRIVATE"}')}));
challenge('sensitive-field-inside-prototype-like-extra',()=>normalizeEvent({...event,...JSON.parse('{"__proto__":{"authorization":"SYNTHETIC_PRIVATE"}}')}));
challenge('blocked-canonical-sanitized-output',()=>normalizeEvaluation({...evaluation,decision:'BLOCK',sanitized_output:'SYNTHETIC_PRIVATE'}));
challenge('nested-permitted-output-is-refused',()=>normalizeEvaluation({...evaluation,extra:{sanitized_output:'SYNTHETIC_PRIVATE'}}));
challenge('benign-extra-metadata-survives-compatibility',()=>normalizeEvent({...event,evidence_class:'protected'}),false);
challenge('allowed-output-remains-omitted-from-view',()=>{
 const result=normalizeEvaluation({...evaluation,sanitized_output:'ordinary synthetic text'});
 if('sanitized_output' in result) throw new Error('Permitted output leaked to view');
},false);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)),'reviewer-frontend-probes.json'),JSON.stringify({scope:'Actual adapter source transpiled by installed TypeScript; independent schema probes, separate from live browser',rows},null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
if(rows.some(row=>!row.passed)) process.exitCode=1;
