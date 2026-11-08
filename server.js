import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const commons = 'https://commons.wikimedia.org/w/api.php';
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
async function search(q,type,page) {
  const params = new URLSearchParams({action:'query',generator:'search',gsrsearch:`filetype:multimedia ${q}`,gsrnamespace:'6',gsrlimit:'30',gsroffset:String((page-1)*30),prop:'imageinfo|info',iiprop:'url|mime|size|extmetadata',iiurlwidth:'640',inprop:'url',format:'json',formatversion:'2',origin:'*'});
  // Commons search does not support a generic multimedia filetype; search files in namespace 6 instead.
  params.set('gsrsearch', q);
  const response = await fetch(`${commons}?${params}`, {headers:{'User-Agent':'GlobalMultimediaSearchDemo/1.0 (educational open-source demo; contact: example@example.com)'},signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Media provider returned ${response.status}`);
  const json = await response.json();
  if(json.error) throw new Error(json.error.info || 'Media provider error');
  const pages = json.query?.pages || [];
  const items = pages.map(p => {
    const info=p.imageinfo?.[0]; if(!info) return null;
    const kind=mediaType(info.mime); if(!kind) return null;
    const meta=info.extmetadata||{};
    const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot);/g,' ').replace(/\s+/g,' ').trim();
    return {id:p.pageid,title:p.title.replace(/^File:/,''),type:kind,mime:info.mime,thumbnail:info.thumburl|| (kind==='image'?info.url:null),url:info.url,source:p.fullurl||`https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g,'_'))}`,license:plain(meta.LicenseShortName?.value||meta.UsageTerms?.value||'See source for license'),author:plain(meta.Artist?.value||''),description:plain(meta.ImageDescription?.value||'').slice(0,280),width:info.width||null,height:info.height||null};
  }).filter(x=>x&&(type==='all'||x.type===type));
  return {items,page,hasMore:pages.length===30,provider:'Wikimedia Commons'};
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

const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
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
      return send(res,200,await search(q,type,page));
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!['index.html','style.css','app.js'].includes(name)) return send(res,404,{error:'Not found'});
    const file=await fs.readFile(path.join(root,'public',name));
    res.writeHead(200,{'Content-Type':mimeTypes[path.extname(name)],'X-Content-Type-Options':'nosniff'});res.end(file);
  }catch(err){console.error(err);send(res,502,{error:'Search is temporarily unavailable. Please retry.'});}
});
server.listen(port,()=>console.log(`Global Multimedia Search: http://localhost:${port}`));
