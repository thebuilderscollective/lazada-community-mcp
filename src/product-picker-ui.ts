export const PRODUCT_PICKER_URI = "ui://lazada-mcp/product-picker-v4.html";

/**
 * A dependency-free MCP Apps component. It treats every storefront field as
 * untrusted text and inserts it with textContent, never innerHTML.
 */
export const productPickerHtml = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
    * { box-sizing:border-box; }
    body { margin: 0; padding: 16px; color: CanvasText; background: Canvas; height:var(--picker-height,640px); display:flex; flex-direction:column; overflow:hidden; }
    header, footer { flex-shrink:0; }
    #groups { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding-bottom:12px; }
    .heading { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px; }
    #expand { background:transparent; color:CanvasText; border:1px solid GrayText; white-space:nowrap; }
    #display-note { margin:6px 0; color:GrayText; font-size:12px; }
    header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
    h1 { font-size:18px; margin:0; }
    #status { color: GrayText; }
    section { margin-top:18px; }
    h2 { font-size:15px; margin:0 0 8px; }
    h3 { font-size:14px; margin:14px 0 8px; }
    .comparison { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; text-align:left; font-size:13px; }
    caption { text-align:left; font-weight:650; padding:0 0 8px; }
    th, td { padding:8px; border-bottom:1px solid color-mix(in srgb, CanvasText 18%, Canvas); vertical-align:top; }
    .photo { width:64px; min-height:64px; display:grid; place-items:center; }
    .photo-missing { font-size:11px; color:GrayText; text-align:center; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:12px; }
    .card { min-width:0; border:1px solid color-mix(in srgb, CanvasText 25%, Canvas); border-radius:12px; padding:16px; }
    .choice { display:grid; grid-template-columns:20px 64px minmax(0,1fr); align-items:start; gap:12px; cursor:pointer; }
    .card:has(input[type=radio]:checked) { border:2px solid #E52D35; padding:15px; }
    .card:has(input:disabled) { opacity:.65; }
    .choice input { margin:6px 0; }
    .quantity { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:16px; border-top:1px solid color-mix(in srgb,CanvasText 18%,Canvas); padding-top:12px; }
    .quantity label { font-weight:600; }
    .line-total { margin-left:auto; font-variant-numeric:tabular-nums; }
    .product-copy { min-width:0; overflow-wrap:anywhere; }
    input, button { font:inherit; }
    a:focus-visible, input:focus-visible, button:focus-visible { outline:2px solid CanvasText; outline-offset:3px; }
    a { color:LinkText; text-underline-offset:3px; overflow-wrap:anywhere; }
    .product-link { display:inline-block; margin-top:12px; padding:4px 0; }
    .secondary { background:Canvas; color:CanvasText; border:1px solid GrayText; }
    [hidden] { display:none !important; }
    @media(max-width:420px) { body { padding:12px; } .card { padding:12px; } .card:has(input[type=radio]:checked) { padding:11px; } .summary { flex-wrap:wrap; } }

    img { width:64px; height:64px; border-radius:8px; object-fit:contain; background:white; }
    .name { font-weight:650; font-size:15px; line-height:1.5; }
    .price { margin-top:8px; font-size:17px; font-weight:650; }
    .meta { color:CanvasText; font-size:13px; margin-top:4px; }
    footer { margin:0 -16px -16px; padding:12px 16px; background:Canvas; border-top:1px solid color-mix(in srgb, CanvasText 18%, Canvas); }
    .summary { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    button { border:0; border-radius:9px; padding:9px 13px; color:white; background:#E52D35; font-weight:650; cursor:pointer; }
    button[disabled] { opacity:.5; cursor:not-allowed; }
    #confirm { display:none; margin-top:10px; padding:10px; border-radius:10px; background:color-mix(in srgb,#ffb916 18%,Canvas); }
    #result { margin-top:8px; white-space:pre-wrap; }
    .qty { width:84px; height:40px; align-self:center; padding:6px 8px; border:1px solid GrayText; border-radius:6px; color:CanvasText; background:Canvas; }
  </style>
</head>
<body>
  <header><div class="heading"><h1>Choose RedMart products</h1><span id="status">Loading…</span></div><button id="expand" type="button" aria-expanded="false">Expand</button></header>
  <p id="display-note" role="status" hidden></p>
  <main id="groups"></main>
  <footer>
    <div class="summary"><span id="summary">Nothing has been added yet.</span><button id="review" disabled>Review selection</button></div>
    <div id="confirm">Nothing is added until you press the confirmation button. <button id="add">Confirm add to cart</button></div>
    <div id="result" role="status" aria-live="polite"></div>
    <button id="refresh" class="secondary" type="button" hidden>Refresh options</button>
  </footer>
<script>
(() => {
  const pending = new Map(); let nextId = 1; let shortlist = null; const selected = new Map(); const controls = new Map(); let blocked=false; let refreshSafe=true;
  const groupsEl = document.getElementById('groups'); const statusEl = document.getElementById('status');
  const summaryEl = document.getElementById('summary'); const reviewEl = document.getElementById('review');
  const confirmEl = document.getElementById('confirm'); const addEl = document.getElementById('add'); const resultEl = document.getElementById('result');
  const refreshEl=document.getElementById('refresh');
  const expandEl=document.getElementById('expand'), displayNote=document.getElementById('display-note');
  let hostContext={}, initialized=false, taller=false, lastHeight=0, resizeFrame=0;
  function scheduleSize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{
      const dims=hostContext.containerDimensions || {};
      const natural=groupsEl.scrollHeight + document.querySelector('header').offsetHeight + document.querySelector('footer').offsetHeight + displayNote.offsetHeight + 44;
      let height=hostContext.displayMode==='fullscreen' ? (dims.height || window.innerHeight) : Math.min(taller ? 960 : 720, Math.max(320,natural));
      if(Number.isFinite(dims.height)) height=dims.height;
      else if(Number.isFinite(dims.maxHeight)) height=Math.min(height,dims.maxHeight);
      height=Math.max(1,Math.ceil(height));
      document.body.style.setProperty('--picker-height',height+'px');
      if(initialized && lastHeight!==height) { lastHeight=height; parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height}},'*'); }
    });
  }
  function applyHostContext(context) {
    hostContext={...hostContext,...context};
    const expanded=hostContext.displayMode==='fullscreen' || taller;
    expandEl.textContent=expanded ? 'Collapse' : 'Expand';
    expandEl.setAttribute('aria-expanded',String(expanded));
    scheduleSize();
  }
  expandEl.onclick=async()=>{
    displayNote.hidden=true;
    const mode=hostContext.displayMode==='fullscreen' ? 'inline' : 'fullscreen';
    if(hostContext.availableDisplayModes?.includes(mode)) {
      expandEl.disabled=true;
      try {
        const result=await rpc('ui/request-display-mode',{mode},5000);
        applyHostContext({displayMode:result.mode});
        if(result.mode!==mode) { displayNote.textContent='The app kept this view inline. Scroll inside the products to see all options.'; displayNote.hidden=false; }
      } catch { displayNote.textContent='The app could not expand this view. Scroll inside the products to see all options.'; displayNote.hidden=false; }
      finally { expandEl.disabled=false; scheduleSize(); }
    } else {
      taller=!taller; applyHostContext({});
      displayNote.textContent='Fullscreen is unavailable here. Scroll inside the products to see all options.'; displayNote.hidden=false; scheduleSize();
    }
  };
  new ResizeObserver(scheduleSize).observe(groupsEl);
  new ResizeObserver(scheduleSize).observe(document.querySelector('footer'));
  addEventListener('resize',scheduleSize);
  const money = n => new Intl.NumberFormat(document.documentElement.lang || 'en-SG', {style:'currency',currency:'SGD'}).format(n);
  function rpc(method, params, timeout=0) { const id=nextId++; return new Promise((resolve,reject)=>{const timer=timeout ? setTimeout(()=>{pending.delete(id);reject(new Error('Host request timed out'));},timeout) : null;pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');}); }
  function text(tag, value, cls) { const el=document.createElement(tag); if(cls) el.className=cls; el.textContent=value == null ? '' : String(value); return el; }
  function productLink(product, label, cls) {
    let url; try { url=new URL(product.url); } catch { return text('span',label); }
    if(url.protocol!=='https:' || !['lazada.sg','www.lazada.sg'].includes(url.hostname) || url.username || url.password || (url.port && url.port!=='443') || !/\/products\/[^/]*-i\d+(?:-s\d+)?\.html$/i.test(url.pathname)) return text('span',label);
    const link=text('a',label,cls);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','View '+product.name+' on Lazada');
    link.onclick=async event=>{event.preventDefault();event.stopPropagation();try{const result=await rpc('ui/open-link',{url:url.href},5000);if(result?.isError)throw new Error('Link declined');}catch{resultEl.textContent='The app could not open this link. Copy it into your browser: '+url.href;scheduleSize();}};
    return link;
  }
  function selectionRows() { return [...selected.entries()].map(([groupId, value]) => ({groupId,url:value.product.url,quantity:value.quantity})); }
  function validQuantity(value) { return Number.isInteger(value) && value>=1 && value<=50; }
  function persist() {
    const rows=selectionRows(), missing=rows.filter(row=>!validQuantity(row.quantity)).length;
    const unknownPrice=rows.some(row=>selected.get(row.groupId).product.price == null);
    const subtotal=rows.reduce((sum,row)=>sum+((selected.get(row.groupId).product.price || 0)*(validQuantity(row.quantity)?row.quantity:0)),0);
    summaryEl.textContent=rows.length ? rows.length+' choices · '+(missing?'enter pack quantities':unknownPrice?'some prices unavailable':'estimated '+money(subtotal))+' · nothing added yet' : 'Choose products and enter how many packs you want.';
    reviewEl.disabled=blocked || rows.length===0 || missing>0; confirmEl.style.display='none';
    for(const [groupId,options] of controls) for(const control of options.values()) {
      const choice=selected.get(groupId), active=choice?.product.url===control.product.url;
      control.comparisonQuantity.textContent=active&&validQuantity(choice.quantity)?String(choice.quantity):'—';
      control.lineTotal.textContent=active&&validQuantity(choice.quantity)&&control.product.price!=null?money(choice.quantity*control.product.price)+' total':'';
    }
    const state={shortlistId:shortlist.shortlistId,selections:rows};
    try { localStorage.setItem('lazada-picker:'+shortlist.shortlistId,JSON.stringify(state)); } catch {}
    if(window.openai?.setWidgetState) window.openai.setWidgetState({modelContent:rows.length+' choices; nothing added yet.',privateContent:state});
  }
  function showRefresh(message) { for(const options of controls.values())for(const c of options.values()){c.radio.disabled=c.product.inStock===false;c.qty.disabled=c.radio.disabled;}blocked=true; refreshSafe=true; resultEl.textContent=message; refreshEl.hidden=false; persist(); scheduleSize(); }
  function render(data, previous) {
    if(!Array.isArray(data?.groups)) return;
    shortlist=data; blocked=false; refreshSafe=true; resultEl.textContent=""; refreshEl.hidden=true; addEl.disabled=false; groupsEl.replaceChildren(); selected.clear(); controls.clear(); statusEl.textContent=data.groups.length + ' requested items';
    for (const group of data.groups) {
      const section=document.createElement('section'); section.append(text('h2',group.query + ' · choose one'));
      const comparison=document.createElement('div'); comparison.className='comparison'; const table=document.createElement('table'); table.append(text('caption','Compare the details'));
      const head=document.createElement('thead'), headers=document.createElement('tr'); for(const label of ['Product','Pack size','Price / pack','Chosen packs']) { const cell=text('th',label); cell.scope='col'; headers.append(cell); } head.append(headers); table.append(head);
      const rows=document.createElement('tbody');
      const quantityCells=new Map();
      for(const product of group.candidates) { if(!product.url) continue; const row=document.createElement('tr'); const nameCell=document.createElement('td');nameCell.append(productLink(product,product.name));row.append(nameCell);for(const value of [product.pack?.label || 'Not listed',product.price == null ? 'Unavailable' : money(product.price)]) row.append(text('td',value)); const cell=text('td','—');quantityCells.set(product.url,cell);row.append(cell);rows.append(row); }
      table.append(rows); comparison.append(table); if(group.candidates.length) section.append(comparison,text('h3','Choose a product and quantity'));
      if(!group.candidates.length) section.append(text('p','No matching options on this results page. Ask your assistant to try a different Lazada search.','meta'));
      const cards=document.createElement('div'); cards.className='cards';
      for (const product of group.candidates) {
        if (!product.url) continue; const card=document.createElement('article'); card.className='card'; const choice=document.createElement('label');choice.className='choice'; const radio=document.createElement('input'); radio.type='radio'; radio.name=group.groupId;
        radio.disabled=product.inStock === false; const photo=document.createElement('div'); photo.className='photo'; const image=document.createElement('img'); image.alt=product.name; image.loading='lazy'; image.referrerPolicy='no-referrer'; const missing=()=>photo.replaceChildren(text('span','Photo unavailable','photo-missing')); if(product.image) { image.onerror=missing; image.src=product.image; photo.append(image); } else missing(); const body=document.createElement('div'); body.className='product-copy'; body.append(text('div',product.name,'name'));
        body.append(text('div',product.price == null ? 'Price unavailable' : money(product.price)+' / pack','price'));
        const details=[product.pack?.label || 'Pack size not listed']; if(product.discount) details.push(product.discount); if(product.purchaseHistory) details.push('In ' + product.purchaseHistory.ordersContaining + ' observed orders'); if(product.rating != null) details.push('★ ' + Number(product.rating).toFixed(1)); if(product.inStock === false) details.push('Out of stock');
        body.append(text('div',details.join(' · ') || 'Pack size not listed','meta'));
        const qty=document.createElement('input'); qty.type='number'; qty.min='1'; qty.max='50'; qty.value=group.quantity == null ? '' : String(group.quantity); qty.placeholder='Qty'; qty.disabled=radio.disabled; qty.className='qty'; qty.id='qty-'+group.groupId+'-'+cards.children.length; qty.setAttribute('aria-label','Packs of '+product.name);
        const quantity=document.createElement('div');quantity.className='quantity';const quantityLabel=text('label','Packs');quantityLabel.htmlFor=qty.id;const lineTotal=text('span','','line-total');quantity.append(quantityLabel,qty,lineTotal);
        const update=()=>{const value=qty.value===''?null:Number(qty.value);if(validQuantity(value))radio.checked=true;if(radio.checked){selected.set(group.groupId,{product,quantity:value});persist();}};radio.onchange=update;qty.oninput=update;qty.onchange=update;
        if(!controls.has(group.groupId)) controls.set(group.groupId,new Map()); controls.get(group.groupId).set(product.url,{radio,qty,product,lineTotal,comparisonQuantity:quantityCells.get(product.url)});
        choice.append(radio,photo,body);card.append(choice,productLink(product,'View product ↗','product-link'),quantity); cards.append(card);
      }
      section.append(cards); groupsEl.append(section);
    }
    let saved=previous || window.openai?.widgetState?.privateContent;
    if(!previous && saved?.shortlistId!==data.shortlistId) saved=null;
    if(!saved) try { saved=JSON.parse(localStorage.getItem('lazada-picker:'+data.shortlistId)); } catch {}
    if(!saved && Array.isArray(data.initialSelections)) saved={shortlistId:data.shortlistId,selections:data.initialSelections};
    let removed=0;
    if((previous || saved?.shortlistId===data.shortlistId)&&Array.isArray(saved?.selections)) for(const row of saved.selections){const control=controls.get(row.groupId)?.get(row.url);if(!control||control.radio.disabled){removed++;continue;}control.radio.checked=true;control.qty.value=row.quantity==null?'':String(row.quantity);selected.set(row.groupId,{product:control.product,quantity:row.quantity});}
    persist(); scheduleSize();
    if(previous) resultEl.textContent='Options refreshed. Matching choices and quantities were kept. '+(removed?removed+' previous choices are no longer offered; choose replacements. ':'')+'Review the current prices before confirming.';
    if(Date.parse(data.expiresAt)<=Date.now()) showRefresh('These prices need refreshing. Your choices are kept; refresh options before adding.');
  }
  refreshEl.onclick=async()=>{
    if(!refreshSafe || !shortlist) return;
    const previous={selections:selectionRows()}; refreshEl.disabled=true;reviewEl.disabled=true;addEl.disabled=true;resultEl.textContent='Refreshing options; keeping matching choices…';
    try {
      const out=await rpc('tools/call',{name:'shortlist_products',arguments:{items:shortlist.groups.map(g=>({query:g.query,...(g.quality?{quality:g.quality}:{})})),limit_per_item:Math.min(5,Math.max(3,...shortlist.groups.map(g=>g.requestedLimit || 3)))}});
      if(out?.isError || !Array.isArray(out?.structuredContent?.groups)) throw new Error('Refresh failed');
      render(out.structuredContent,previous);
    } catch { resultEl.textContent='Options could not be refreshed. Your choices are still here. Try Refresh options again; nothing was added.'; }
    finally { refreshEl.disabled=false; scheduleSize(); }
  };
  addEventListener('message', event => { if(event.source!==parent) return; const msg=event.data; if(!msg||msg.jsonrpc!=='2.0') return; if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);return;} if(msg.method==='ui/notifications/host-context-changed') applyHostContext(msg.params || {}); if(msg.method==='ui/notifications/tool-result'&&Array.isArray(msg.params?.structuredContent?.groups)) render(msg.params.structuredContent); }, {passive:true});
  rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Lazada picker',version:'1.1.3'},appCapabilities:{availableDisplayModes:['inline','fullscreen']}}).then(result=>{initialized=true;applyHostContext(result.hostContext || {});parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');scheduleSize();}).catch(()=>{statusEl.textContent='Use the comparison in the conversation.';});
  if(window.openai?.toolOutput?.groups) render(window.openai.toolOutput);
  reviewEl.onclick=()=>{if(Date.parse(shortlist.expiresAt)<=Date.now()){showRefresh('These prices need refreshing. Your choices are kept; refresh options before adding.');return;}confirmEl.style.display='block';scheduleSize();};
  addEl.onclick=async()=>{
    if(blocked)return; blocked=true;for(const options of controls.values())for(const c of options.values()){c.radio.disabled=true;c.qty.disabled=true;}addEl.disabled=true;reviewEl.disabled=true;confirmEl.style.display='none';resultEl.textContent='Adding your selected packs…';
    try {
      const out=await rpc('tools/call',{name:'add_shortlist_to_cart',arguments:{shortlist_id:shortlist.shortlistId,selections:selectionRows().map(r=>({group_id:r.groupId,url:r.url,quantity:r.quantity})),confirm:true}});
      const data=out?.structuredContent;
      if(out?.isError && data?.recovery==='refresh_options') { showRefresh(data.message);return; }
      refreshSafe=false;refreshEl.hidden=true;
      resultEl.textContent=data?.message || out?.content?.map(c=>c.text||'').join(' ') || 'Check the cart before retrying; the result is uncertain.';
      summaryEl.textContent=data?.complete?'Selected packs added. No order placed.':'Check the cart before another add attempt.';
    } catch { refreshSafe=false;refreshEl.hidden=true;resultEl.textContent='Connection interrupted. Check the cart before retrying; some items may already have been added.'; }
    finally { reviewEl.disabled=true;confirmEl.style.display='none';scheduleSize(); }
  };
})();
</script>
</body></html>`;
