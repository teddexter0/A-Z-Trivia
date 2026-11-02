// Adapter for the real ChorusClip schema: clips[].youtubeVideoId and loops[].start/end.
export function importChorus(input) {
  const clips=Array.isArray(input)?input:Array.isArray(input.clips)?input.clips:[input];
  if(!clips.length||clips.length>100)throw new Error('Import between 1 and 100 Chorus Clip selections.');
  const questions=clips.map((clip,i)=>{
    const loop=clip.loops?.[0];const videoId=loop?.youtubeVideoId||clip.youtubeVideoId;
    if(!/^[A-Za-z0-9_-]{11}$/.test(videoId||''))throw new Error('Clip '+(i+1)+': valid YouTube video ID required.');
    const rawTitle=String(clip.title||'').trim().slice(0,120),artist=String(clip.artist||'').trim().slice(0,120);
    const title=String(clip.songTitle||rawTitle.replace(new RegExp('^'+artist.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[-–—]\\s*','i'),'').replace(/\s*[\[(](?:official|video oficial|audio oficial|lyrics|letra)[^\])]*[\])]\s*/gi,' ').trim()).slice(0,120);
    if(!title||!artist)throw new Error('Clip '+(i+1)+': add the song title and artist.');
    const start=Number(loop?.start),end=Number(loop?.end);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>90)throw new Error('Clip '+(i+1)+': select a valid 1–90 second loop in Chorus Clip first.');
    const aliases=[rawTitle,...(Array.isArray(clip.titleAliases)?clip.titleAliases.filter(x=>typeof x==='string').slice(0,10):[])];
    const artists=[...artist.split(/\s+(?:feat\.?|ft\.?|&|x)\s+|,\s*/i).filter(Boolean),...(Array.isArray(clip.artistAliases)?clip.artistAliases.filter(x=>typeof x==='string').slice(0,10):[])];
    return {id:'song-'+videoId,entity:'song-'+videoId,category:'music',prompt:'¿Qué canción es? ¿Quién la canta?',hints:['Song title and artist each earn 50 points.'],media:{kind:'youtube',videoId,start,end},parts:[{label:'Canción / Song',answers:[title,...aliases],placeholder:'Song title — leave blank if unsure'},{label:'Artista / Artist',answers:[artist,...artists],placeholder:'Artist — leave blank if unsure'}],explanation:title+' — '+artist,source:'https://www.youtube.com/watch?v='+videoId,chorusClipId:clip.id||null};
  });
  const unique=new Map(questions.map(q=>[q.entity,q]));return [...unique.values()];
}
export function decodeFirestore(value){
  if(value.stringValue!==undefined)return value.stringValue;
  if(value.booleanValue!==undefined)return value.booleanValue;
  if(value.integerValue!==undefined)return Number(value.integerValue);
  if(value.doubleValue!==undefined)return value.doubleValue;
  if(value.arrayValue)return (value.arrayValue.values||[]).map(decodeFirestore);
  if(value.mapValue)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeFirestore(v)]));
  return null;
}
export async function publicChorusSelection(link,fetcher=fetch){
  let url;try{url=new URL(link);}catch{throw new Error('Paste a full public Chorus Clip share link.');}
  if(url.protocol!=='https:'||url.hostname!=='chorus-clip.vercel.app')throw new Error('Use a chorus-clip.vercel.app public share link.');
  const clipId=url.searchParams.get('clip'),playlistId=url.searchParams.get('playlist');
  const id=clipId||playlistId;if(!id||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('The share link needs ?clip=ID or ?playlist=ID.');
  const base='https://firestore.googleapis.com/v1/projects/chorusclip-57072/databases/(default)/documents/';
  async function document(collection,id){const r=await fetcher(base+collection+'/'+encodeURIComponent(id),{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('This Chorus Clip selection is unavailable or private. Publish it in Chorus Clip, or import your own JSON.');const data=await r.json();return {id,...Object.fromEntries(Object.entries(data.fields||{}).map(([k,v])=>[k,decodeFirestore(v)]))};}
  if(clipId){const clip=await document('clips',id);if(clip.isPublic!==true)throw new Error('Only public share links can be read without signing in to Chorus Clip.');return importChorus(clip);}
  const playlist=await document('publicPlaylists',id),live=[];
  for(const clip of (playlist.clips||[]).slice(0,20)){try{if(clip.id){const current=await document('clips',clip.id);if(current.isPublic===true)live.push(current);}else if(clip.isPublic===true)live.push(clip);}catch{ /* Never resurrect a now-private clip from a stale public mirror. */ }}
  if(!live.length)throw new Error('No currently public clips remain in this playlist.');return importChorus(live);
}
