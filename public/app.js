const $ = s => document.querySelector(s);
const state={query:'',type:'all',page:1,loading:false,items:[],hasMore:false,request:0};
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
function showViewer(item){const content=$('#viewerContent');content.replaceChildren();content.append(element('h2','',item.title));
  let media;if(item.type==='image'){media=element('img');media.alt=item.title;media.src=item.url;}else if(item.type==='video'){media=element('video');media.controls=true;media.preload='metadata';media.src=item.url;}else{media=element('audio');media.controls=true;media.preload='none';media.src=item.url;}content.append(media);
  if(item.description)content.append(element('p','',item.description));content.append(element('p','',`License: ${item.license}${item.author?' · Author: '+item.author:''}`));
  const link=element('a','', 'Open original media / download ↗');link.href=item.source;link.target='_blank';link.rel='noopener noreferrer';content.append(link);$('#viewer').showModal();
}
async function load(reset=false){if(state.loading)return;if(!state.query)return;
  if(reset){state.page=1;state.items=[];grid.replaceChildren();}
  const current=++state.request;state.loading=true;more.hidden=true;status.textContent='Searching global media library…';
  try{const p=new URLSearchParams({q:state.query,type:state.type,page:String(state.page)});const response=await fetch(`/api/search?${p}`);const data=await response.json();if(!response.ok)throw new Error(data.error||'Search failed');if(current!==state.request)return;
    state.items.push(...data.items);grid.append(...data.items.map(card));state.hasMore=data.hasMore;
    status.textContent=data.items.length? '':(state.page===1?'No results found. Try different keywords.':'No more results on this page.');
    $('#summary').textContent=`${state.items.length} matching results loaded for “${state.query}” · ${state.type==='all'?'All media':state.type}`;
    more.hidden=!state.hasMore;
  }catch(error){status.textContent=error.message+' Please try again.';}finally{state.loading=false;}
}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();const q=$('#query').value.trim();if(!q)return;state.query=q;load(true);$('#results').scrollIntoView({behavior:'smooth'});});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{$('#query').value=button.dataset.query;state.query=button.dataset.query;load(true);$('#results').scrollIntoView({behavior:'smooth'});}));
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{if(state.loading)return;document.querySelectorAll('[data-type]').forEach(b=>b.classList.remove('active'));button.classList.add('active');state.type=button.dataset.type;if(state.query)load(true);}));
more.addEventListener('click',()=>{state.page++;load();});$('#closeViewer').addEventListener('click',()=>{$('#viewer').close();$('#viewerContent').replaceChildren();});$('#viewer').addEventListener('close',()=>$('#viewerContent').replaceChildren());
