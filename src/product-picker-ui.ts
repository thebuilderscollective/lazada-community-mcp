export const PRODUCT_PICKER_URI = "ui://lazada-mcp/product-picker-v2.html";

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
    :root { color-scheme: light dark; font: 14px/1.4 system-ui, sans-serif; }
    body { margin: 0; padding: 16px; color: CanvasText; background: Canvas; }
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
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; }
    label.card { display:grid; grid-template-columns:20px 64px minmax(0,1fr) 52px; gap:8px; border:1px solid color-mix(in srgb, CanvasText 18%, Canvas); border-radius:12px; padding:10px; cursor:pointer; }
    label.card:has(input:checked) { border-color:#E52D35; box-shadow:0 0 0 2px color-mix(in srgb,#E52D35 20%,transparent); }
    label.card:has(input:disabled) { opacity:.58; cursor:not-allowed; }
    img { width:64px; height:64px; border-radius:8px; object-fit:contain; background:white; }
    .name { font-weight:650; }
    .price { margin-top:4px; }
    .meta { color:GrayText; font-size:12px; margin-top:3px; }
    footer { position:sticky; bottom:0; margin:20px -16px -16px; padding:12px 16px; background:Canvas; border-top:1px solid color-mix(in srgb, CanvasText 18%, Canvas); }
    .summary { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    button { border:0; border-radius:9px; padding:9px 13px; color:white; background:#E52D35; font-weight:650; cursor:pointer; }
    button[disabled] { opacity:.5; cursor:not-allowed; }
    #confirm { display:none; margin-top:10px; padding:10px; border-radius:10px; background:color-mix(in srgb,#ffb916 18%,Canvas); }
    #result { margin-top:8px; white-space:pre-wrap; }
    .qty { width:48px; }
  </style>
</head>
<body>
  <header><h1>Choose RedMart products</h1><span id="status">Loading…</span></header>
  <main id="groups"></main>
  <footer>
    <div class="summary"><span id="summary">Nothing has been added yet.</span><button id="review" disabled>Review selection</button></div>
    <div id="confirm">Nothing is added until you press the confirmation button. <button id="add">Confirm add to cart</button></div>
    <div id="result"></div>
  </footer>
<script>
(() => {
  const pending = new Map(); let nextId = 1; let shortlist = null; const selected = new Map(); const controls = new Map();
  const groupsEl = document.getElementById('groups'); const statusEl = document.getElementById('status');
  const summaryEl = document.getElementById('summary'); const reviewEl = document.getElementById('review');
  const confirmEl = document.getElementById('confirm'); const addEl = document.getElementById('add'); const resultEl = document.getElementById('result');
  const money = n => new Intl.NumberFormat(document.documentElement.lang || 'en-SG', {style:'currency',currency:'SGD'}).format(n);
  function rpc(method, params) { const id = nextId++; parent.postMessage({jsonrpc:'2.0',id,method,params},'*'); return new Promise((resolve,reject)=>pending.set(id,{resolve,reject})); }
  function text(tag, value, cls) { const el=document.createElement(tag); if(cls) el.className=cls; el.textContent=value == null ? '' : String(value); return el; }
  function selectionRows() { return [...selected.entries()].map(([groupId, value]) => ({groupId,url:value.product.url,quantity:value.quantity})); }
  function persist() {
    const rows=selectionRows(); const subtotal=rows.reduce((sum,row)=>{const hit=selected.get(row.groupId); return sum + ((hit.product.price || 0) * row.quantity);},0);
    summaryEl.textContent = rows.length ? rows.length + '/' + shortlist.groups.length + ' chosen · estimated ' + money(subtotal) + ' · enter quantities · nothing added yet' : 'Nothing has been added yet.';
    reviewEl.disabled = rows.length === 0 || rows.some(row => !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 50); confirmEl.style.display='none';
    if (window.openai?.setWidgetState) window.openai.setWidgetState({modelContent:rows.length + ' products selected; estimated subtotal ' + money(subtotal) + '; nothing added yet.',privateContent:{shortlistId:shortlist.shortlistId,selections:rows}});
  }
  function render(data) {
    shortlist=data; groupsEl.replaceChildren(); selected.clear(); controls.clear(); statusEl.textContent=data.groups.length + ' requested items';
    for (const group of data.groups) {
      const section=document.createElement('section'); section.append(text('h2',group.query + ' · choose one'));
      const comparison=document.createElement('div'); comparison.className='comparison'; const table=document.createElement('table'); table.append(text('caption','Compare the details'));
      const head=document.createElement('thead'), headers=document.createElement('tr'); for(const label of ['Product','Pack','Price','Unit price','Stock']) { const cell=text('th',label); cell.scope='col'; headers.append(cell); } head.append(headers); table.append(head);
      const rows=document.createElement('tbody');
      for(const product of group.candidates) { if(!product.url) continue; const row=document.createElement('tr'); for(const value of [product.name,product.pack?.label || 'Unknown',product.price == null ? 'Unavailable' : money(product.price),product.unitPrice ? money(product.unitPrice.value) + '/' + product.unitPrice.per : 'Unknown',product.inStock === true ? 'In stock' : product.inStock === false ? 'Out of stock' : 'Unknown']) row.append(text('td',value)); rows.append(row); }
      table.append(rows); comparison.append(table); section.append(comparison,text('h3','Compare the packaging'));
      if(!group.candidates.length) section.append(text('p',group.relevance?.note || 'No candidates were returned. Try another Lazada query.','meta'));
      const cards=document.createElement('div'); cards.className='cards';
      for (const product of group.candidates) {
        if (!product.url) continue; const card=document.createElement('label'); card.className='card'; const radio=document.createElement('input'); radio.type='radio'; radio.name=group.groupId;
        radio.disabled=product.inStock === false; const photo=document.createElement('div'); photo.className='photo'; const image=document.createElement('img'); image.alt=product.name; image.loading='lazy'; image.referrerPolicy='no-referrer'; const missing=()=>photo.replaceChildren(text('span','Photo unavailable','photo-missing')); if(product.image) { image.onerror=missing; image.src=product.image; photo.append(image); } else missing(); const body=document.createElement('div'); body.append(text('div',product.name,'name'));
        body.append(text('div',product.price == null ? 'Price unavailable' : money(product.price),'price'));
        const details=[]; if(product.pack) details.push(product.pack.label); if(product.unitPrice) details.push(money(product.unitPrice.value) + '/' + product.unitPrice.per); if(product.discount) details.push(product.discount); if(product.purchaseHistory) details.push('In ' + product.purchaseHistory.ordersContaining + ' observed orders'); if(product.rating != null) details.push('★ ' + product.rating); if(product.inStock === false) details.push('Out of stock');
        body.append(text('div',details.join(' · ') || 'Pack/unit price unavailable','meta'));
        const qty=document.createElement('input'); qty.type='number'; qty.min='1'; qty.max='50'; qty.value=group.quantity == null ? '' : String(group.quantity); qty.placeholder='Qty'; qty.disabled=radio.disabled; qty.className='qty'; qty.setAttribute('aria-label','Quantity'); qty.onclick=e=>e.stopPropagation();
        radio.onchange=()=>{selected.set(group.groupId,{product,quantity:Number(qty.value)}); persist();}; qty.onchange=()=>{const hit=selected.get(group.groupId); if(hit && hit.product.url === product.url){hit.quantity=Number(qty.value); persist();}};
        if(!controls.has(group.groupId)) controls.set(group.groupId,new Map()); controls.get(group.groupId).set(product.url,{radio,qty,product});
        card.append(radio,photo,body,qty); cards.append(card);
      }
      section.append(cards); groupsEl.append(section);
    }
    const saved=window.openai?.widgetState?.privateContent;
    if(saved?.shortlistId===data.shortlistId&&Array.isArray(saved.selections)) for(const row of saved.selections){const control=controls.get(row.groupId)?.get(row.url);if(!control||control.radio.disabled)continue;control.radio.checked=true;control.qty.value=String(Math.max(1,Math.min(50,Number(row.quantity)||1)));selected.set(row.groupId,{product:control.product,quantity:Number(control.qty.value)});}
    persist();
  }
  addEventListener('message', event => { if(event.source!==parent) return; const msg=event.data; if(!msg||msg.jsonrpc!=='2.0') return; if(msg.id!==undefined&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);return;} if(msg.method==='ui/notifications/tool-result'&&msg.params?.structuredContent) render(msg.params.structuredContent); }, {passive:true});
  rpc('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Lazada picker',version:'1.1.0'},appCapabilities:{}}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')).catch(()=>{statusEl.textContent='Use the comparison in the conversation.';});
  if(window.openai?.toolOutput?.groups) render(window.openai.toolOutput);
  reviewEl.onclick=()=>{confirmEl.style.display='block';};
  addEl.onclick=async()=>{addEl.disabled=true; resultEl.textContent='Adding selected products…'; try { const out=await rpc('tools/call',{name:'add_shortlist_to_cart',arguments:{shortlist_id:shortlist.shortlistId,selections:selectionRows().map(r=>({group_id:r.groupId,url:r.url,quantity:r.quantity})),confirm:true}}); const data=out?.structuredContent; resultEl.textContent=data?.message || out?.content?.map(c=>c.text||'').join(' ') || 'Check the conversation and cart before retrying.'; } catch(error) { resultEl.textContent='Could not add the batch. Nothing further was attempted.'; } finally { reviewEl.disabled=true; confirmEl.style.display='none'; } };
})();
</script>
</body></html>`;
