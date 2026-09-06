import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {ShortlistStore} from '../dist/shortlist-store.js';
import {createShortlist,addShortlistToCart} from '../dist/shortlist.js';
const search=async query=>({requestedLimit:3,returnedCount:1,totalAvailable:1,results:[{name:query,url:'https://www.lazada.sg/products/demo-i123-s456.html',price:2,inStock:true}]});
async function fixture(t){const dir=await mkdtemp('/tmp/lazada-persist-');t.after(()=>rm(dir,{recursive:true,force:true}));const file=dir+'/private/drafts.json';return {file,store:new ShortlistStore(file)};}
test('shortlists survive a new process, expiry is distinct, and storage remains private',async t=>{
 const {file,store}=await fixture(t);const draft=await createShortlist([{query:'tomatoes'}],{},search,store);
 const module=new URL('../dist/shortlist-store.js',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {ShortlistStore} from ${JSON.stringify(module)};console.log(new ShortlistStore(process.argv[1]).get(process.argv[2]).shortlistId)`,file,draft.shortlistId],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),draft.shortlistId);
 assert.equal((await stat(file)).mode & 0o777,0o600);assert.equal((await stat(file.replace('/drafts.json',''))).mode & 0o777,0o700);
 draft.expiresAt=new Date(Date.now()-1000).toISOString();store.save(draft);
 assert.throws(()=>store.get(draft.shortlistId),e=>e.code==='shortlist_expired');
 assert.equal(store.get(draft.shortlistId,true).shortlistId,draft.shortlistId);
 assert.throws(()=>store.get('missing'),e=>e.code==='shortlist_missing');
});
test('consumption survives restart and failed batches cannot replay',async t=>{
 const {file,store}=await fixture(t);const draft=await createShortlist([{query:'tomatoes'},{query:'salt'}],{},search,store);
 const selections=draft.groups.map(g=>({groupId:g.groupId,url:g.candidates[0].url,quantity:2}));let calls=0;
 const result=await addShortlistToCart({shortlistId:draft.shortlistId,selections,confirm:true},{store,add:async()=>{calls++;assert.throws(()=>new ShortlistStore(file).get(draft.shortlistId),e=>e.code==='shortlist_consumed');throw new Error('simulated failure');}});
 assert.equal(calls,1);assert.equal(result.notAttemptedCount,1);
 await assert.rejects(()=>addShortlistToCart({shortlistId:draft.shortlistId,selections,confirm:true},{store:new ShortlistStore(file),add:async()=>{throw new Error('must not run')}}),e=>e.code==='shortlist_consumed');
});
test('invalid choices and storage corruption fail before cart operations',async t=>{
 const {file,store}=await fixture(t);const draft=await createShortlist([{query:'tomatoes'}],{},search,store);
 let calls=0;const add=async()=>{calls++;return {ok:true}};
 await assert.rejects(()=>addShortlistToCart({shortlistId:draft.shortlistId,selections:[{groupId:'item-1',url:draft.groups[0].candidates[0].url,quantity:0}],confirm:true},{store,add}),/explicit quantity/);
 assert(store.get(draft.shortlistId));assert.equal(calls,0);
 await writeFile(file,'corrupt');
 await assert.rejects(()=>addShortlistToCart({shortlistId:draft.shortlistId,selections:[],confirm:true},{store,add}),/could not be read/);assert.equal(calls,0);
});
