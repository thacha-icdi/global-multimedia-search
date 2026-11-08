import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const commons = 'https://commons.wikimedia.org/w/api.php';
const aliases = {'เห็ดโคน':['Termitomyces','termite mushroom'],'ข้าวแต๋น':['khao taen','Thai rice cracker']};
const allowedTypes = new Set(['all','image','video','audio']);
const mimeTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};

function send(res,status,body,type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function mediaType(mime='') {
  if(mime.startsWith('image/')) return 'image';
  if(mime.startsWith('video/')) return 'video';
  if(mime.startsWith('audio/')) return 'audio';
  if(mime==='application/ogg') return 'audio';
  return null;
}

function normalized(value){
 return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[_–—-]+/g,' ').replace(/\s+/g,' ').trim();
}
function relevant(item,query){
 const q=normalized(query);
 const title=normalized(item.title).replace(/\.[a-z0-9]{2,6}$/,'');
 const description=normalized(item.description);
 const terms=q.split(/\s+/).filter(Boolean);
 if(!terms.length)return false;
 // Do not accept generic metadata or unrelated fuzzy results.
 // A full phrase in either the title or descriptive metadata is evidence.
 if(title.includes(q)||description.includes(q))return true;
 return terms.length>1 && terms.every(t=>t.length>1&&(title.includes(t)||description.includes(t)));
}

async function search(q,type,page) {
 const target=24, batch=50, maxBatches=5;
 const found=[],seen=new Set();
 let offset=(page-1)*batch*maxBatches, exhausted=false;
 const searchText=q;
 for(let attempt=0;attempt<maxBatches && found.length<target;attempt++){
  const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:searchText,gsrnamespace:'6',gsrlimit:String(batch),gsroffset:String(offset),prop:'imageinfo|info',iiprop:'url|mime|size|extmetadata',iiurlwidth:'640',inprop:'url',format:'json',formatversion:'2'});
  const response=await fetch(`${commons}?${params}`,{headers:{'User-Agent':'GlobalMultimediaSearch/4.0 (educational multimedia search)'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Wikimedia Commons returned ${response.status}`);
  const json=await response.json();
  if(json.error)throw new Error(json.error.info||'Wikimedia Commons search error');
  const pages=json.query?.pages||[];
  const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g,' ').replace(/\s+/g,' ').trim();
  for(const p of pages){
   const info=p.imageinfo?.[0];if(!info)continue;
   const kind=mediaType(info.mime);
   if(!kind||(type!=='all'&&kind!==type)||seen.has(p.pageid))continue;
   const meta=info.extmetadata||{};
   const item={id:p.pageid,title:p.title.replace(/^File:/,''),type:kind,mime:info.mime,thumbnail:info.thumburl||(kind==='image'?info.url:null),url:info.url,source:p.fullurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g,'_'))}`,license:plain(meta.LicenseShortName?.value||meta.UsageTerms?.value||'See source for license'),author:plain(meta.Artist?.value||''),description:plain(meta.ImageDescription?.value||meta.ObjectName?.value||'').slice(0,700),width:info.width||null,height:info.height||null};
   if(relevant(item,q)){seen.add(p.pageid);found.push(item);}
  }
  offset+=batch;
  if(pages.length<batch||!json.continue){exhausted=true;break;}
 }
 return {items:found.slice(0,target),page,hasMore:!exhausted,provider:'Wikimedia Commons'};
}

async function searchCommons(q,type,page){
 const terms=[q,...(aliases[normalized(q)]||[])];
 const results=await Promise.allSettled(terms.map(term=>search(term,type,page)));
 const successful=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
 if(!successful.length)throw new Error('Wikimedia Commons is temporarily unavailable');
 const seen=new Set(),items=[];
 for(const result of successful)for(const item of result.items){
  if(seen.has(item.id))continue;
  seen.add(item.id);items.push(item);
 }
 return {items,hasMore:successful.some(r=>r.hasMore),provider:'Wikimedia Commons',warnings:results.some(r=>r.status==='rejected')?['Some Wikimedia searches could not be completed.']:[]};
}

async function searchYouTube(q,pageToken='') {
  const key=process.env.YOUTUBE_API_KEY;
  if(!key) return {error:'YouTube API key is not configured on the server.',status:503};
  const params=new URLSearchParams({part:'snippet',q,type:'video',maxResults:'20',key,videoEmbeddable:'true',safeSearch:'moderate'});
  if(pageToken) params.set('pageToken',pageToken);
  const response=await fetch('https://www.googleapis.com/youtube/v3/search?'+params,{signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok) {
    console.error('YouTube API error:',response.status,data.error?.message);
    return {error:response.status===403?'YouTube API quota or access limit reached.': 'YouTube search is temporarily unavailable.',status:response.status===403?429:502};
  }
  return {items:(data.items||[]).filter(x=>x.id?.videoId).map(x=>({
    id:x.id.videoId,title:x.snippet.title,type:'video',provider:'YouTube',
    thumbnail:x.snippet.thumbnails?.high?.url||x.snippet.thumbnails?.medium?.url||'',
    url:'https://www.youtube.com/watch?v='+encodeURIComponent(x.id.videoId),
    source:'https://www.youtube.com/watch?v='+encodeURIComponent(x.id.videoId),
    description:x.snippet.description||'',author:x.snippet.channelTitle||'',license:'YouTube — check creator rights'
  })),nextPageToken:data.nextPageToken||'',hasMore:!!data.nextPageToken,provider:'YouTube'};
}


async function knowledge(q){
  const languages=/[ก-๙]/.test(q)?['th','en']:['en','th'];
  for(const lang of languages){
    try{
      const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:lang==='en'?(aliases[normalized(q)]?.[0]||q):q,gsrnamespace:'0',gsrlimit:'5',prop:'extracts|info',exintro:'1',explaintext:'1',exchars:'1100',inprop:'url',format:'json',formatversion:'2'});
      const response=await fetch('https://'+lang+'.wikipedia.org/w/api.php?'+params,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'GlobalMultimediaSearch/3.0 (educational project)'}});
      if(!response.ok)continue;
      const data=await response.json();
      const pages=(data.query?.pages||[]).filter(p=>p.extract?.trim());
      if(pages.length)return {items:pages.map(p=>({title:p.title,extract:p.extract,url:p.fullurl||'https://'+lang+'.wikipedia.org/wiki/'+encodeURIComponent(p.title.replace(/ /g,'_')),language:lang})),source:'Wikipedia'};
    }catch(e){console.warn('Knowledge lookup failed:',e.message);}
  }
  return {items:[],source:'Wikipedia'};
}
async function allMedia(q,page){
  const jobs=await Promise.allSettled([searchCommons(q,'all',page),searchYouTube(q)]);
  const commonsResult=jobs[0].status==='fulfilled'?jobs[0].value:null;
  const youtubeResult=jobs[1].status==='fulfilled'?jobs[1].value:null;
  if(!commonsResult&&!youtubeResult?.items)throw new Error('All media providers unavailable');
  const images=(commonsResult?.items||[]).filter(x=>x.type==='image').slice(0,16);
  const audio=(commonsResult?.items||[]).filter(x=>x.type==='audio').slice(0,8);
  const commonsVideos=(commonsResult?.items||[]).filter(x=>x.type==='video').slice(0,6);
  const videos=(youtubeResult?.items||[]).slice(0,12);
  const items=[];const groups=[images,videos,audio,commonsVideos];let more=true;
  while(more){more=false;for(const group of groups)if(group.length){items.push(group.shift());more=true;}}
  return {items,hasMore:!!commonsResult?.hasMore,provider:'Wikimedia Commons + YouTube',warnings:[!youtubeResult?.items?'YouTube is unavailable or its API quota has been reached.':null,!commonsResult?'Wikimedia Commons is unavailable.':null].filter(Boolean)};
}

const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/api/knowledge'){
      const q=(url.searchParams.get('q')||'').trim();
      if(!q||q.length>150)return send(res,400,{error:'Invalid query'});
      return send(res,200,await knowledge(q));
    }
    if(url.pathname==='/api/all'){
      const q=(url.searchParams.get('q')||'').trim();
      const page=Math.max(1,Math.min(20,Number.parseInt(url.searchParams.get('page')||'1',10)||1));
      if(!q||q.length>150)return send(res,400,{error:'Invalid query'});
      return send(res,200,await allMedia(q,page));
    }
    if(url.pathname==='/api/youtube/search') {
      const q=(url.searchParams.get('q')||'').trim();
      const pageToken=(url.searchParams.get('pageToken')||'').trim();
      if(!q||q.length>150||pageToken.length>300||!(/^[A-Za-z0-9_-]*$/.test(pageToken))) return send(res,400,{error:'Invalid YouTube search parameters.'});
      const result=await searchYouTube(q,pageToken);
      return send(res,result.status||200,result.status?{error:result.error}:result);
    }
    if(url.pathname==='/api/search') {
      const q=(url.searchParams.get('q')||'').trim();
      const type=url.searchParams.get('type')||'all';
      const page=Math.max(1,Math.min(20,Number.parseInt(url.searchParams.get('page')||'1',10)||1));
      if(!q||q.length>150||!allowedTypes.has(type)) return send(res,400,{error:'Enter a query (1–150 characters) and a valid media type.'});
      return send(res,200,await searchCommons(q,type,page));
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','style.css','app.js'].includes(name)) return send(res,404,{error:'Not found'});
    const file=await fs.readFile(path.join(root,'public',name));
    res.writeHead(200,{'Content-Type':mimeTypes[path.extname(name)],'X-Content-Type-Options':'nosniff'});res.end(file);
  }catch(err){console.error(err);send(res,502,{error:'Search is temporarily unavailable. Please retry.'});}
});
server.listen(port,()=>console.log(`Global Multimedia Search: http://localhost:${port}`));
