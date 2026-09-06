import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const installer=resolve('scripts/install.sh');
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'lazada-install-test-'));const bin=join(root,'bin'),downloads=join(root,'downloads');await mkdir(bin);await mkdir(downloads);
 const archive='fixture package';await writeFile(join(root,'asset'),archive);await writeFile(join(root,'SHA256SUMS'),['lazada-mcp.tgz','lazada-mcp.mcpb'].map(name=>createHash('sha256').update(archive).digest('hex')+'  '+name).join('\n')+'\n');
 const stubs={
  curl:'[ "${FAIL_DOWNLOAD:-0}" != 1 ] || exit 22\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1 ;; -o) shift; output=$1 ;; esac; shift; done\ncase "$url" in */SHA256SUMS) cp "$FIXTURE/SHA256SUMS" "$output" ;; *) cp "$FIXTURE/asset" "$output" ;; esac',
  node:'exit 0',
  npx:'printf "%s\\n" "$@" > "$FIXTURE/invocation"\n[ -f "$2" ] || exit 3\ncat "$2" > "$FIXTURE/installed-asset"',
  uname:'printf "%s\\n" "${TEST_SYSTEM:-Linux}"',
  open:'printf "%s\\n" "$1" > "$FIXTURE/opened"\n[ -f "$1" ]',
 };
 for(const [name,body] of Object.entries(stubs))await writeFile(join(bin,name),'#!/bin/sh\nset -eu\n'+body+'\n',{mode:0o700});
 const env={...process.env,PATH:bin+':/usr/bin:/bin',FIXTURE:root,TMPDIR:downloads,XDG_CACHE_HOME:join(root,'cache'),LAZADA_RELEASE_BASE_URL:'https://example.test/releases/download/v1.1.0'};
 const run=(target,extra={})=>spawnSync('/bin/sh',[installer,target],{env:{...env,...extra},encoding:'utf8'});
 try{await fn({root,downloads,run})}finally{await rm(root,{recursive:true,force:true})}
}
test('curl installer verifies and hands off to the existing client setup, cleaning temporary downloads',async()=>fixture(async({root,downloads,run})=>{
 for(const [target,client] of [['codex','codex'],['claude-code','claude'],['grok','config']]){
  const r=run(target);assert.equal(r.status,0,r.stderr);const args=(await readFile(join(root,'invocation'),'utf8')).trim().split('\n');assert.deepEqual(args.slice(-2),['setup',client]);assert.equal(await readFile(join(root,'installed-asset'),'utf8'),'fixture package');assert.deepEqual(await readdir(downloads),[]);
 }
}));
test('checksum failure and failed downloads never execute setup',async()=>fixture(async({root,downloads,run})=>{
 await writeFile(join(root,'asset'),'tampered package');let r=run('codex');assert.notEqual(r.status,0);assert.match(r.stderr,/checksum mismatch/);await assert.rejects(readFile(join(root,'invocation')));assert.deepEqual(await readdir(downloads),[]);
 r=run('codex',{FAIL_DOWNLOAD:'1'});assert.notEqual(r.status,0);await assert.rejects(readFile(join(root,'invocation')));assert.deepEqual(await readdir(downloads),[]);
}));
test('Desktop installer opens a verified persistent bundle and leaves native approval to the user',async()=>fixture(async({root,downloads,run})=>{
 const r=run('claude-desktop',{TEST_SYSTEM:'Darwin'});assert.equal(r.status,0,r.stderr);const opened=(await readFile(join(root,'opened'),'utf8')).trim();assert.ok(opened.startsWith(join(root,'cache')));assert.equal(await readFile(opened,'utf8'),'fixture package');await assert.rejects(readFile(join(root,'invocation')));assert.deepEqual(await readdir(downloads),[]);
 assert.notEqual(run('claude-desktop').status,0);
}));
test('invalid targets and unpublished/non-HTTPS installer locations fail before installation',async()=>fixture(async({root,run})=>{
 for(const [target,env] of [['wrong',{}],['codex',{LAZADA_RELEASE_BASE_URL:'http://example.test'}],['codex',{LAZADA_RELEASE_BASE_URL:''}]])assert.notEqual(run(target,env).status,0);
 await assert.rejects(readFile(join(root,'invocation')));
 assert.equal(run('--help').status,0);
}));
