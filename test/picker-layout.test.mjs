import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { productPickerHtml } from '../dist/product-picker-ui.js';
const executablePath=process.env.LAZADA_TEST_CHROME;
test('picker resizes a short iframe, expands through the host, and preserves selections', {skip:!executablePath}, async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1100,height:950}});
  const data={shortlistId:'fixture',groups:Array.from({length:8},(_,i)=>({groupId:String(i),query:'Fixture item '+i,candidates:[{name:'Fixture product '+i,url:'https://www.lazada.sg/products/fixture-i123-s456.html',price:2,inStock:true}]}))};
  await page.setContent('<iframe title="Picker" style="width:100%;height:150px;border:0"></iframe>');
  await page.evaluate(({html,data})=>{
   window.messages=[]; window.refuse=false;
   const iframe=document.querySelector('iframe');
   addEventListener('message',e=>{
    if(e.source!==iframe.contentWindow)return;
    const m=e.data;window.messages.push(m);
    const send=msg=>iframe.contentWindow.postMessage({jsonrpc:'2.0',...msg},'*');
    if(m.method==='ui/initialize')send({id:m.id,result:{hostContext:{displayMode:'inline',availableDisplayModes:['inline','fullscreen']}}});
    if(m.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-result',params:{structuredContent:data}});
    if(m.method==='ui/notifications/size-changed')iframe.style.height=m.params.height+'px';
    if(m.method==='ui/request-display-mode') { const mode=window.refuse?'inline':m.params.mode;iframe.style.height=mode==='fullscreen'?'900px':'720px';send({id:m.id,result:{mode}});send({method:'ui/notifications/host-context-changed',params:{displayMode:mode,containerDimensions:mode==='fullscreen'?{height:900}:{maxHeight:720}}}); }
   });
   iframe.srcdoc=html;
  },{html:productPickerHtml,data});
  const frame=page.frameLocator('iframe');
  await frame.getByText('8 requested items').waitFor();
  await page.waitForFunction(()=>parseInt(document.querySelector('iframe').style.height)>=600);
  assert.equal(await frame.locator('section').count(),8);
  await frame.locator('input[type=radio]').first().check();
  await frame.locator('.qty').first().fill('2');
  await frame.locator('.qty').first().dispatchEvent('change');
  await frame.getByRole('button',{name:'Expand',exact:true}).click();
  await frame.getByRole('button',{name:'Collapse',exact:true}).waitFor();
  assert.equal(await frame.locator('input[type=radio]').first().isChecked(),true);
  assert.equal(await frame.locator('.qty').first().inputValue(),'2');
  const bounds=await frame.locator('#groups').evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
  assert(bounds.scroll>bounds.client,'long lists scroll within the picker');
  await frame.locator('section').last().scrollIntoViewIfNeeded();
  assert(await frame.getByRole('button',{name:'Collapse',exact:true}).isVisible());
  await frame.getByRole('button',{name:'Collapse',exact:true}).click();
  await frame.getByRole('button',{name:'Expand',exact:true}).waitFor();
  await page.evaluate(()=>window.refuse=true);
  await frame.getByRole('button',{name:'Expand',exact:true}).click();
  await frame.getByText('The app kept this view inline.',{exact:false}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'Expand',exact:true}).getAttribute('aria-expanded'),'false');
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{availableDisplayModes:['inline'],containerDimensions:{maxHeight:600}}},'*'));
  await frame.getByRole('button',{name:'Expand',exact:true}).click();
  await frame.getByText('Fullscreen is unavailable here.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.messages.some(m=>m.method==='tools/call')),false);
  assert(await page.evaluate(()=>window.messages.filter(m=>m.method==='ui/notifications/size-changed').length<20),'size notifications must stabilize');
 } finally { await browser.close(); }
});

test('pack comparison stays readable and refresh preserves only matching choices', {skip:!executablePath}, async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:600,height:950}});
  const product={name:'RedMart Local Tomatoes 600G',url:'https://www.lazada.sg/products/fixture-i123-s456.html',price:1.6,pack:{label:'600g'},unitPrice:{label:'$2.67/kg'},rating:4.913644214162349,inStock:true};
  const data={shortlistId:'old',expiresAt:new Date(Date.now()+60000).toISOString(),groups:[{groupId:'item-1',query:'tomatoes',candidates:[product,{...product,name:'Other tomatoes',url:product.url+'?other=1'}]}]};
  await page.setContent('<iframe title="Picker" style="width:100%;height:720px;border:0"></iframe>');
  await page.evaluate(({html,data})=>{
   window.calls=[];window.links=[];window.denyLink=false;window.consumed=false;
   const iframe=document.querySelector('iframe');
   addEventListener('message',e=>{
    if(e.source!==iframe.contentWindow)return;const m=e.data;
    const send=msg=>iframe.contentWindow.postMessage({jsonrpc:'2.0',...msg},'*');
    if(m.method==='ui/initialize')send({id:m.id,result:{hostContext:{displayMode:'inline',containerDimensions:{maxHeight:720}}}});
    if(m.method==='ui/notifications/initialized')send({method:'ui/notifications/tool-result',params:{structuredContent:data}});
    if(m.method==='ui/open-link'){window.links.push(m.params.url);send({id:m.id,result:{isError:window.denyLink}});}
    if(m.method==='tools/call'){
     window.calls.push(m.params);
     if(m.params.name==='add_shortlist_to_cart')send({id:m.id,result:{isError:true,structuredContent:window.consumed?{message:'Already submitted; check the cart.',recovery:'inspect_cart'}:{message:'Saved comparison unavailable.',recovery:'refresh_options'}}});
     if(m.params.name==='shortlist_products')send({id:m.id,result:{structuredContent:{...data,shortlistId:'new',groups:data.groups.map(g=>({...g,candidates:[{...g.candidates[0],price:2.3}]}))}}});
    }
   });iframe.srcdoc=html;
  },{html:productPickerHtml,data});
  const frame=page.frameLocator('iframe');
  await frame.locator('.card').first().waitFor();
  assert.equal(await frame.getByRole('columnheader',{name:'Unit price',exact:true}).count(),0);
  assert.equal(await frame.getByText(/\/kg|\/100g/).count(),0);
  assert.equal(await frame.getByText('★ 4.9',{exact:false}).count(),2);
  for(const width of [600,380]){
   await page.setViewportSize({width,height:950});
   const bounds=await frame.locator('.card').first().evaluate(el=>{const name=el.querySelector('.product-copy').getBoundingClientRect(),q=el.querySelector('.quantity').getBoundingClientRect(),input=el.querySelector('.qty').getBoundingClientRect();return {nameBottom:name.bottom,quantityTop:q.top,inputHeight:input.height,overflow:el.scrollWidth>el.clientWidth};});
   assert(bounds.quantityTop>=bounds.nameBottom);assert(bounds.inputHeight<=44);assert.equal(bounds.overflow,false);
  }
  const link=frame.locator('.product-link').first();
  assert.equal(await link.getAttribute('href'),product.url);
  await link.click();
  assert.deepEqual(await page.evaluate(()=>window.links),[product.url]);
  assert.equal(await frame.locator('input[type=radio]').first().isChecked(),false);
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.evaluate(()=>window.denyLink=true);
  await link.click();
  await frame.getByText('The app could not open this link.',{exact:false}).waitFor();
  await frame.locator('.qty').first().fill('2');
  assert(await frame.locator('input[type=radio]').first().isChecked());
  await frame.getByText('$3.20 total',{exact:true}).waitFor();
  await frame.getByRole('button',{name:'Review selection',exact:true}).click();
  await frame.getByRole('button',{name:'Confirm add to cart',exact:true}).click();
  await frame.getByRole('button',{name:'Refresh options',exact:true}).click();
  await frame.getByText('Options refreshed.',{exact:false}).waitFor();
  assert.equal(await frame.locator('.qty').first().inputValue(),'2');
  await frame.getByText('$4.60 total',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'Confirm add to cart',exact:true}).isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.name)),['add_shortlist_to_cart','shortlist_products']);
  await page.screenshot({path:'/tmp/lazada-picker-packs.png'});
  await page.evaluate(()=>window.consumed=true);
  await frame.getByRole('button',{name:'Review selection',exact:true}).click();
  await frame.getByRole('button',{name:'Confirm add to cart',exact:true}).click();
  await frame.getByText('Already submitted; check the cart.',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('button',{name:'Refresh options',exact:true}).isVisible(),false);
  assert(await frame.getByRole('button',{name:'Review selection',exact:true}).isDisabled());
 } finally {await browser.close();}
});
