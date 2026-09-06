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
