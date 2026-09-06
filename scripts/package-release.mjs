#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const [repository,...extra]=process.argv.slice(2);
if(!repository || extra.length || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Usage: node scripts/package-release.mjs OWNER/REPO');
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a stable package version.');
const tag=`v${pkg.version}`, output=resolve(root,'releases',tag);
await mkdir(output,{recursive:true});
function run(command,args){const r=spawnSync(command,args,{cwd:root,stdio:'inherit',shell:false});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${command} failed; no release was published.`);}
run('npm',['run','validate:plugin']);
run('npm',['pack','--pack-destination',output]);
await copyFile(join(output,`lazada-mcp-${pkg.version}.tgz`),join(output,'lazada-mcp.tgz'));
run(process.execPath,['scripts/package-desktop.mjs',join(output,'lazada-mcp.mcpb')]);
const template=await readFile(join(root,'scripts/install.sh'),'utf8');
await writeFile(join(output,'install.sh'),template.replace('__LAZADA_RELEASE_BASE_URL__',`https://github.com/${repository}/releases/download/${tag}`));
const sums=[];
for(const name of ['lazada-mcp.tgz','lazada-mcp.mcpb','install.sh']) sums.push(`${createHash('sha256').update(await readFile(join(output,name))).digest('hex')}  ${name}`);
await writeFile(join(output,'SHA256SUMS'),sums.join('\n')+'\n');
console.log(`Release staged at ${output}. Nothing was published.`);
console.log(`After publishing ${tag}: curl -fsSL https://github.com/${repository}/releases/latest/download/install.sh | sh -s -- claude-desktop`);
