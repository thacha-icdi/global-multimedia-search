const $ = s => document.querySelector(s);
const state={query:'',type:'all',page:1,loading:false,items:[],hasMore:false,request:0,provider:'commons',nextPageToken:'',controller:null};
const grid=$('#grid'),status=$('#status'),more=$('#more');
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
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
  if(reset){state.page=1;state.nextPageToken='';state.items=[];grid.replaceChildren();}
  const current=++state.request;state.loading=true;more.hidden=true;
  status.textContent='Searching '+(state.provider==='youtube'?'YouTube':'Wikimedia Commons')+'…';
  try{
    const params=new URLSearchParams({q:state.query});
    let endpoint;
    if(state.provider==='youtube'){
      if(state.nextPageToken)params.set('pageToken',state.nextPageToken);
      endpoint='/api/youtube/search';
    }else{
      params.set('type',state.type);params.set('page',String(state.page));
      endpoint='/api/search';
    }
    const response=await fetch(endpoint+'?'+params,{signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Search failed');
    if(current!==state.request)return;
    state.items.push(...data.items);grid.append(...data.items.map(card));
    state.hasMore=data.hasMore;state.nextPageToken=data.nextPageToken||'';
    status.textContent=data.items.length?'':(state.page===1?'No results found. Try different keywords.':'No more results.');
    $('#summary').textContent=state.items.length+' results loaded for “'+state.query+'” · '+(state.provider==='youtube'?'YouTube':state.type);
    more.hidden=!state.hasMore;
  }catch(error){if(error.name!=='AbortError'&&current===state.request)status.textContent=error.message+' Please try again.';}
  finally{if(current===state.request){state.loading=false;state.controller=null;}}
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
  if(state.query)load(true);
}
$('#provider').addEventListener('change',updateProvider);
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#query').value.trim();if(!q)return;state.query=q;load(true);$('#results').scrollIntoView({behavior:'smooth'});});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{$('#query').value=button.dataset.query;state.query=button.dataset.query;load(true);$('#results').scrollIntoView({behavior:'smooth'});}));
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{
  const type=button.dataset.type;
  if(type==='video'){
    state.provider='youtube';
    state.type='video';
    $('#provider').value='youtube';
  }else{
    state.provider='commons';
    state.type=type;
    $('#provider').value='commons';
  }
  document.querySelectorAll('[data-type]').forEach(b=>{b.classList.toggle('active',b===button);b.disabled=false;});
  if(state.query)load(true);
}));
more.addEventListener('click',()=>{state.page++;load();});$('#closeViewer').addEventListener('click',()=>{$('#viewer').close();$('#viewerContent').replaceChildren();});$('#viewer').addEventListener('close',()=>$('#viewerContent').replaceChildren());
