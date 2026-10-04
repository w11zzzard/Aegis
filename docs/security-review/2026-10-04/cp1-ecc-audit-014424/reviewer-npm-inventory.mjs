import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(process.argv[2]);
const lock=JSON.parse(readFileSync(join(root,'frontend/package-lock.json'),'utf8'));
const rows=Object.entries(lock.packages).filter(([name,item])=>name&&item.version).map(([name,item])=>{
  const file=join(root,'frontend',name,'package.json');
  const installed=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).version:null;
  return {package:name,locked:item.version,installed,matches:installed===item.version,optional:!!item.optional};
});
const result={rows,mismatch:rows.filter(row=>!row.matches&&!row.optional),platform_optional_absent:rows.filter(row=>!row.installed&&row.optional).length};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)),'reviewer-npm-inventory.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({checked:rows.length,mismatch:result.mismatch,platform_optional_absent:result.platform_optional_absent},null,2));
