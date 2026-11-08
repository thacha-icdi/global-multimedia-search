const $ = s => document.querySelector(s);
const state={query:'',type:'all',page:1,loading:false,items:[],hasMore:false,request:0,provider:'all',nextPageToken:'',controller:null};
const grid=$('#grid'),status=$('#status'),more=$('#more');
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function mediaFingerprint(item){
  if(item.provider==='YouTube')return 'youtube:'+item.id;
  const raw=String(item.url||item.thumbnail||'');
  const filename=raw.split('/').pop().split('?')[0].replace(/^\d+px-/,'').toLowerCase();
  const title=String(item.title||'').normalize('NFKC').toLowerCase().replace(/\.[a-z0-9]{2,5}$/,'').replace(/\b(?:copy|duplicate|thumb|thumbnail|small|medium|large|original|[0-9]+px)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  return title||filename||String(item.id);
}
// Compare thumbnail appearance as well as file names. Fail open when a provider blocks canvas access.
const visualHashes=[];
function imageHash(url,signal){
  return new Promise(resolve=>{
    if(!url)return resolve(null);
    const img=new Image();img.crossOrigin='anonymous';
    const timeout=setTimeout(()=>resolve(null),3500);
    const finish=value=>{clearTimeout(timeout);resolve(value);};
    img.onload=()=>{
      try{
        if(signal?.aborted)return finish(null);
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.fillStyle='#fff';ctx.fillRect(0,0,16,16);ctx.drawImage(img,0,0,16,16);
        const pixels=ctx.getImageData(0,0,16,16).data;
        const samples=[];
        for(let i=0;i<pixels.length;i+=4)samples.push(Math.round((pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114)/32));
        finish(samples);
      }catch{finish(null);}
    };
    img.onerror=()=>finish(null);
    img.src=url;
  });
}
function visualDistance(a,b){
  let diff=0;
  for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1)diff++;
  return diff/a.length;
}
async function removeVisualDuplicates(items,signal){
  const output=[];
  for(const item of items){
    if(signal?.aborted)break;
    if(item.type!=='image'||!item.thumbnail){output.push(item);continue;}
    const hash=await imageHash(item.thumbnail,signal);
    if(hash && visualHashes.some(previous=>visualDistance(previous,hash)<0.12))continue;
    if(hash)visualHashes.push(hash);
    output.push(item);
  }
  return output;
}
function refreshSummary(){
 $('#summary').textContent=state.items.length+' results loaded for “'+state.query+'” · '+(state.provider==='all'?'All sources':state.provider==='youtube'?'video':state.type);
}
function card(item){
  const article=element('article','item'),preview=element('div','preview');
  if(item.thumbnail){const img=element('img');img.src=item.thumbnail;img.alt=item.title;img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{img.remove();preview.append(element('div','placeholder',item.type==='audio'?'♫':item.type==='video'?'▷':'▧'));};preview.append(img);}
  else preview.append(element('div','placeholder',item.type==='audio'?'♫':item.type==='video'?'▷':'▧'));
  preview.append(element('span','kind',item.type));article.append(preview);
  const detail=element('div','details');detail.append(element('h3','',item.title),element('p','',item.license));
  const actions=element('div','actions'),view=element('button','',item.type==='audio'?'Listen':item.type==='video'?'Watch':'Preview');view.addEventListener('click',()=>showViewer(item));
  const source=element('a','', 'Source ↗');source.href=item.source;source.target='_blank';source.rel='noopener noreferrer';actions.append(view,source);detail.append(actions);article.append(detail);return article;
}
function showViewer(item){
  if(item.provider==='YouTube'){
    const content=$('#viewerContent');content.replaceChildren();
    content.append(element('h2','',item.title));
    const frame=element('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+encodeURIComponent(item.id);
    frame.title=item.title;frame.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.className='youtube-frame';
    content.append(frame);
    const note=element('p','', 'Video by '+(item.author||'YouTube creator')+'. Playback subject to YouTube availability and creator permissions.');content.append(note);
    const link=element('a','', 'Watch on YouTube ↗');link.href=item.source;link.target='_blank';link.rel='noopener noreferrer';content.append(link);
    $('#viewer').showModal();return;
  }const content=$('#viewerContent');content.replaceChildren();content.append(element('h2','',item.title));
  let media;if(item.type==='image'){media=element('img');media.alt=item.title;media.src=item.url;}else if(item.type==='video'){media=element('video');media.controls=true;media.preload='metadata';media.src=item.url;}else{media=element('audio');media.controls=true;media.preload='none';media.src=item.url;}content.append(media);
  if(item.description)content.append(element('p','',item.description));content.append(element('p','',`License: ${item.license}${item.author?' · Author: '+item.author:''}`));
  const link=element('a','', 'Open original media / download ↗');link.href=item.source;link.target='_blank';link.rel='noopener noreferrer';content.append(link);$('#viewer').showModal();
}
async function load(reset=false){
  if(!state.query)return;
  if(state.controller)state.controller.abort();
  const controller=new AbortController();state.controller=controller;
  if(reset){state.page=1;state.nextPageToken='';state.items=[];visualHashes.length=0;grid.replaceChildren();refreshSummary();loadKnowledge(state.query);}
  const current=++state.request;state.loading=true;more.hidden=true;refreshSummary();
  status.textContent='Searching '+(state.provider==='all'?'all sources':state.provider==='youtube'?'YouTube':'Wikimedia Commons')+'…';
  try{
    const params=new URLSearchParams({q:state.query});
    let endpoint;
    if(state.provider==='youtube'){
      if(state.nextPageToken)params.set('pageToken',state.nextPageToken);
      endpoint='/api/youtube/search';
    }else if(state.provider==='all'){
      params.set('page',String(state.page));endpoint='/api/all';
    }else{
      params.set('type',state.type);params.set('page',String(state.page));
      endpoint='/api/search';
    }
    const timeout=setTimeout(()=>controller.abort(),30000);
    let response;
    try{response=await fetch(endpoint+'?'+params,{signal:controller.signal});}finally{clearTimeout(timeout);}
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Search failed');
    if(current!==state.request)return;
    const seen=new Set(state.items.map(mediaFingerprint));
    const unique=(data.items||[]).filter(item=>{
      const fingerprint=mediaFingerprint(item);
      if(seen.has(fingerprint))return false;
      seen.add(fingerprint);return true;
    });
    const visuallyUnique=await removeVisualDuplicates(unique,controller.signal);
    if(current!==state.request||controller.signal.aborted)return;
    state.items.push(...visuallyUnique);grid.append(...visuallyUnique.map(card));
    state.hasMore=Boolean(data.hasMore);
    if(data.warnings?.length)status.textContent=data.warnings.join(' ');state.nextPageToken=data.nextPageToken||'';
    if(!data.warnings?.length)status.textContent=state.items.length?'':(state.type==='audio'?'No matching audio recordings were found in Wikimedia Commons. Try a broader term, an English translation, or a related sound.':state.page===1?'No results found. Try different keywords.':'No more results.');
    refreshSummary();
    more.hidden=!state.hasMore;more.disabled=state.loading;
  }catch(error){if(current===state.request)status.textContent=error.name==='AbortError'?'Search timed out. Please try again.':error.message+' Please try again.';}
  finally{if(current===state.request){state.loading=false;state.controller=null;more.disabled=false;}}
}
function updateProvider(){
  state.provider=$('#provider').value;
  if(state.provider==='youtube'){
    state.type='video';
    document.querySelectorAll('[data-type]').forEach(b=>{b.classList.toggle('active',b.dataset.type==='video');b.disabled=false;});
  }else{
    state.type='all';
    document.querySelectorAll('[data-type]').forEach(b=>{b.disabled=false;b.classList.toggle('active',b.dataset.type==='all');});
  }
  refreshSummary();if(state.query)load(true);
}

let placeMap=null,placeMarkers=null,placeRequest=0;
function nearbyCategory(q){
 const v=q.toLowerCase();
 if(!/(ใกล้ฉัน|ใกล้ตัว|near me|nearby)/i.test(v))return null;
 if(/ร้านอาหาร|restaurant|food near/i.test(v))return 'restaurant';
 if(/ร้านกาแฟ|คาเฟ่|coffee|cafe/i.test(v))return 'cafe';
 return null;
}
async function searchNearby(category){
 const token=++placeRequest,section=$('#places'),message=$('#placeStatus'),list=$('#placeList');
 section.hidden=false;message.textContent='กำลังขออนุญาตใช้ตำแหน่งเพื่อค้นหาสถานที่ใกล้คุณ…';list.replaceChildren();
 $('#knowledge').hidden=true;grid.replaceChildren();status.textContent='';more.hidden=true;
 if(!navigator.geolocation){message.textContent='เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง';return;}
 try{
  const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:12000,maximumAge:60000}));
  if(token!==placeRequest)return;
  const {latitude:lat,longitude:lon}=position.coords;
  message.textContent='กำลังค้นหาสถานที่จาก OpenStreetMap…';
  const response=await fetch('/api/places?'+new URLSearchParams({lat,lon,category}));
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'Place search unavailable');
  if(token!==placeRequest)return;
  if(typeof L==='undefined')throw Error('Map library could not load');
  if(!placeMap){placeMap=L.map('placeMap');L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(placeMap);placeMarkers=L.layerGroup().addTo(placeMap);}
  placeMarkers.clearLayers();placeMap.setView([lat,lon],13);
  L.circleMarker([lat,lon],{radius:9,color:'#8d82f6',fillOpacity:1}).bindPopup('ตำแหน่งของคุณ').addTo(placeMarkers);
  const items=data.items||[];
  for(const item of items){
   const marker=L.marker([item.lat,item.lon]).addTo(placeMarkers);
   marker.bindPopup(document.createTextNode(item.name));
   const row=element('div','place-card');
   row.append(element('strong','',item.name),element('span','',item.address||'OpenStreetMap location'));
   const link=element('a','', 'นำทางด้วย Google Maps ↗');
   link.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(item.lat+','+item.lon);
   link.target='_blank';link.rel='noopener noreferrer';row.append(link);list.append(row);
  }
  message.textContent=items.length+' สถานที่จาก OpenStreetMap ในรัศมีประมาณ 4 กม. ข้อมูลอาจไม่ครบถ้วน';
  setTimeout(()=>placeMap.invalidateSize(),100);
 }catch(e){if(token!==placeRequest)return;message.textContent=e.code===1?'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาเปิด Location ในเบราว์เซอร์':e.message||'ไม่สามารถค้นหาสถานที่ได้';}
}
function runQuery(q){
 state.query=q;
 const category=nearbyCategory(q);
 if(category){if(state.controller)state.controller.abort();state.request++;searchNearby(category);}
 else{placeRequest++;$('#places').hidden=true;load(true);}
 $('#results').scrollIntoView({behavior:'smooth'});
}

$('#provider').addEventListener('change',updateProvider);
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#query').value.trim();if(!q)return;runQuery(q);});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{$('#query').value=button.dataset.query;runQuery(button.dataset.query);}));
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{
  const type=button.dataset.type;
  if(type==='all'){
    state.provider='all';state.type='all';$('#provider').value='all';
  }else if(type==='video'){
    state.provider='youtube';
    state.type='video';
    $('#provider').value='youtube';
  }else{
    state.provider='commons';
    state.type=type;
    $('#provider').value='commons';
  }
  document.querySelectorAll('[data-type]').forEach(b=>{b.classList.toggle('active',b===button);b.disabled=false;});
  refreshSummary();if(state.query)load(true);
}));
more.addEventListener('click',()=>{if(state.loading||!state.hasMore)return;state.page++;load();});$('#closeViewer').addEventListener('click',()=>{$('#viewer').close();$('#viewerContent').replaceChildren();});$('#viewer').addEventListener('close',()=>$('#viewerContent').replaceChildren());

async function loadKnowledge(query){
 const section=$('#knowledge'),list=$('#knowledgeItems');
 if(!section||!list)return;
 section.hidden=false;list.replaceChildren(element('p','', 'Looking up background information…'));
 try{
  const response=await fetch('/api/knowledge?q='+encodeURIComponent(query));
  if(!response.ok)throw Error('Knowledge search unavailable');
  const data=await response.json();
  if(query!==state.query)return;
  list.replaceChildren();
  if(!data.items?.length){list.append(element('p','', 'No encyclopedia articles found for this query.'));return;}
  for(const item of data.items){
   const article=element('article','knowledge-card');
   const heading=element('h3','',item.title),description=element('p','',item.extract);
   const link=element('a','', 'Read full article on Wikipedia ↗');
   link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
   article.append(heading,description,link);list.append(article);
  }
 }catch{list.replaceChildren(element('p','', 'Background articles are temporarily unavailable.'));}
}
