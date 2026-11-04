import { createRoom, makePack, step, snapshot, submit, control, shuffled } from './engine.mjs';
import { importChorus, publicChorusSelection } from './chorus.mjs';
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const digest=async(v)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const auth=(req)=>req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
const nicknameKey=value=>value.normalize('NFKD').replace(/\p{M}|\p{Cf}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const nickname=v=>String(v||'').trim().slice(0,24).replace(/[<>\x00-\x1f]/g,'');
const caches=new Map();
export function makeApi({store,catalog,config={},local=false,portraitLookup}) {
  return async function api(req) {
    const url=new URL(req.url),path=url.pathname;
    try{
      if(req.method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'Origin mismatch.'},403);
      if(path==='/api/config')return json({firebase:config.firebase||null,transport:config.transport||(local?'sse':'poll'),catalogCount:catalog.length,storage:local?'local-file':'durable-server',version:'1.0.0'});
      if(path==='/api/rooms'&&req.method==='POST') {
        const body=await readBody(req);const name=nickname(body.nickname);if(!nicknameKey(name))return json({error:'Choose a host nickname.'},400);
        if(config.firebase?.apiKey&&!local){const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(config.firebase.apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:body.firebaseToken})});if(!r.ok)return json({error:'Guest identity expired. Reload and try again.'},401);}
        const categories=['faces','places','phrases','culture','campus','music'];
        const mix=body.mix;
        if(mix!==undefined&&(!mix||typeof mix!=='object'||Array.isArray(mix)||Object.entries(mix).some(([key,value])=>!categories.includes(key)||!Number.isInteger(value)||value<0||value>25)))return json({error:'Enter a valid number of questions for each category.'},400);
        const requested=mix?Object.values(mix).reduce((sum,value)=>sum+value,0):null;
        if(mix&&(requested<1||requested>25))return json({error:'Choose between 1 and 25 questions total.'},400);
        const history=await store.history();let imported=[];if(body.chorus)imported=importChorus(body.chorus);const playlist=body.chorusUrl||config.chorusPlaylist;if(playlist&&(!mix||mix.music>0))imported.push(...await publicChorusSelection(playlist));
        const enabled=mix?categories.filter(id=>mix[id]>0):Array.isArray(body.categories)?body.categories:categories;
        const pool=[...catalog,...imported].filter(q=>enabled.includes(q.category));if(mix){
          for(const category of enabled){
            const available=new Set(pool.filter(q=>q.category===category).map(q=>q.entity)).size;
            if(mix[category]>available)return json({error:category==='music'&&!available?'Add a public Chorus Clip playlist or set songs to 0.':'Only '+available+' unique '+category+' questions are available. Adjust your mix.'},400);
          }
        }
        if(!pool.length)return json({error:'Select a category with available questions.'},400);
        const count=Math.max(5,Math.min(25,Number(body.count)||15));
        const pack=makePack(pool,history,requested??count,Math.random,true,mix);
        const songs=pool.filter(q=>q.category==='music');
        if(!mix&&songs.length&&!pack.questions.some(q=>q.category==='music')){
          const musicPack=makePack(songs,history,1);
          pack.questions.splice(Math.floor(pack.questions.length/2),1,musicPack.questions[0]);
          pack.cooldownRelaxed ||= musicPack.cooldownRelaxed;
        }
        const anthems=pool.filter(q=>q.anthem);
        if(anthems.length&&!pack.questions.some(q=>q.anthem)){
          const index=pack.questions.findIndex(q=>q.category==='culture');
          const slot=index>=0?index:mix?-1:pack.questions.findLastIndex(q=>q.category!=='music');
          if(slot>=0){
            const anthemPack=makePack(anthems,history,1);
            pack.questions.splice(slot,1,anthemPack.questions[0]);
            pack.cooldownRelaxed ||= anthemPack.cooldownRelaxed;
          }
        }
        pack.questions.forEach(q=>q.parts.forEach(p=>{if(p.choices)p.choices=shuffled(p.choices);}));
        const hostToken=token(),playerToken=token();let room;
        for(let i=0;i<5;i++){const digits=new Uint32Array(1);crypto.getRandomValues(digits);const code=String(100000+(digits[0]%900000));room=createRoom({code,hostHash:await digest(hostToken),playerHash:await digest(playerToken),nickname:name,pack,now:Date.now(),settings:body});try{await store.insert(room);break;}catch(e){if(i===4)throw e;}}
        return json({code:room.code,hostToken,playerToken,state:snapshot(room,room.players[0].id,true)},201);
      }
      const m=path.match(/^\/api\/rooms\/(\d{6})(?:\/(join|state|answer|control|media|image|portrait|export))?$/);
      if(!m)return json({error:'Not found.'},404);
      const [,code,operation='state']=m;
      if(operation==='image')return await imageResponse(code,req,url,store,catalog);
      const raw=auth(req);const hash=raw?await digest(raw):'';
      let result;
      for(let attempt=0;attempt<8;attempt++) {
        const row=await store.get(code);if(!row||row.room.expiresAt<Date.now())return json({error:'This room is unavailable or expired.'},404);
        const room=row.room,now=Date.now();let changed=step(room,now);const host=hash===room.hostHash;let player=room.players.find(p=>p.tokenHash===hash);
        if(operation==='join'&&req.method==='POST') {
          const body=await readBody(req);const name=nickname(body.nickname);if(!nicknameKey(name))return json({error:'Enter a nickname.'},400);
          if(room.phase==='finished')return json({error:'This session has ended. Ask the host for the next room code.'},409);
          if(room.players.length>=50)return json({error:'This room is full (50 players).'},409);
          if(room.players.some(p=>nicknameKey(p.nickname)===nicknameKey(name)))return json({error:'That nickname is taken. Try another.'},409);
          const playerToken=token();player={id:crypto.randomUUID(),nickname:name,tokenHash:await digest(playerToken),joinedAt:now};room.players.push(player);changed=true;
          result={code,playerToken,state:snapshot(room,player.id,false,now)};
        }else {
          if(!host&&!player)return json({error:'Rejoin with your room code and nickname.'},401);
          if(host&&!player)player=room.players[0];
          if(operation==='answer'&&req.method==='POST') {const body=await readBody(req);if(!Array.isArray(body.values)||body.values.length>3||body.values.some(v=>typeof v!=='string'||v.length>100))return json({error:'Invalid answer.'},400);submit(room,player.id,body.questionId,body.values,now);changed=true;}
          else if(operation==='control'&&req.method==='POST'){if(!host)return json({error:'Host controls are private.'},403);const body=await readBody(req);const stale=body.expectedPhase!==undefined&&(body.expectedPhase!==room.phase||body.expectedIndex!==room.index);
            if(stale){
              if(!['start','next','reveal'].includes(body.action))return json({error:'The question changed. Try again on the current round.'},409);
            }else{control(room,body.action,body,now);changed=true;}}
          else if(operation==='media'&&req.method==='GET') {
            const question=room.questions[room.index];
            const questionId=url.searchParams.get('question');
            if(!['countdown','question'].includes(room.phase)||question?.id!==questionId)return json(null);
            return json(question.media??null);
          }
          else if(operation==='portrait'&&req.method==='GET') {
          const question=room.questions[room.index];
          if(room.phase!=='reveal'||question?.id!==url.searchParams.get('question')||!question.image?.portrait)return json(null);
          return json(await portraitLookup?.(question.image)||null);
        }
        else if(operation==='export') {if(!host||room.phase!=='finished')return json({error:'Export is available to the host after the game.'},403);return json({code,playedAt:new Date(room.createdAt).toISOString(),leaderboard:snapshot(room,player.id,host,now).leaderboard,audit:room.audit,questions:room.questions.map(q=>({id:q.id,prompt:q.prompt,answers:q.parts.map(p=>p.answers[0])})),responses:Object.values(room.answers).map(a=>({...a,player:room.players.find(p=>p.id===a.playerId)?.nickname}))});}
          else if(operation!=='state'&&operation!=='answer'&&operation!=='control')return json({error:'Method not allowed.'},405);
          result=snapshot(room,player.id,host,now);
        }
        if(!changed||await store.cas(code,room,row.revision)){if(room.phase!=='lobby')await store.record(room);return json(result);}
      }
      return json({error:'The room is busy. Please retry.'},409);
    }catch(e){return json({error:e.message||'Unable to complete this action.'},400);}
  };
}
const bodies=new WeakMap();
async function readBody(req){if(bodies.has(req))return bodies.get(req);if(Number(req.headers.get('content-length'))>200000)throw new Error('Import is too large.');const text=await req.text();if(text.length>200000)throw new Error('Import is too large.');const body=JSON.parse(text||'{}');bodies.set(req,body);return body;}
async function imageResponse(code,req,url,store,catalog){
  const row=await store.get(code);if(!row||row.room.expiresAt<Date.now())return json({error:'Room expired.'},404);
  const hash=await digest(auth(req));if(!row.room.players.some(p=>p.tokenHash===hash)&&row.room.hostHash!==hash)return json({error:'Join this room first.'},401);
  step(row.room,Date.now());const q=row.room.questions[row.room.index];if(url.searchParams.has('question')&&url.searchParams.get('question')!==q?.id)return json({error:'The question changed.'},409);if(!q?.image||!['countdown','question','reveal'].includes(row.room.phase))return json({error:'No active image.'},404);
  const {wiki,direct}=catalog.find(item=>item.id===q.id)?.image||q.image;
  const headers={'User-Agent':'LaRondaClubTrivia/1.0 (educational club game)'};
  const get=async endpoint=>{
    const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error('Photo provider unavailable');
    return response.json();
  };
  const wikiPhoto=async()=>{
    const data=await get('https://en.wikipedia.org/w/api.php?format=json&action=query&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=960&pilicense=free&titles='+encodeURIComponent(wiki));
    return Object.values(data.query?.pages||{})[0]?.thumbnail?.source;
  };
  const commonsPhoto=async()=>{
    const data=await get('https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&sites=enwiki&props=claims&titles='+encodeURIComponent(wiki));
    const claim=Object.values(data.entities||{})[0]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if(typeof claim!=='string')return null;
    const commons=await get('https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=960&titles='+encodeURIComponent('File:'+claim));
    const photo=Object.values(commons.query?.pages||{})[0]?.imageinfo?.[0];
    return photo?.extmetadata?.LicenseShortName?.value.match(/^(?:CC |Public domain)/i)?photo.thumburl||photo.url:null;
  };
  const originalPhoto=async()=>{
    const data=await get('https://en.wikipedia.org/w/api.php?format=json&action=query&redirects=1&prop=pageimages&piprop=original&pilicense=free&titles='+encodeURIComponent(wiki));
    return Object.values(data.query?.pages||{})[0]?.original?.source;
  };
  const key=direct||wiki;
  const cached=caches.get(key);
  const attempted=new Set();
  for(const resolve of [()=>cached?.expiry>Date.now()?cached.url:null,()=>direct,wikiPhoto,commonsPhoto,originalPhoto]){
    try{
      const source=await resolve();
      if(!source||attempted.has(source))continue;
      attempted.add(source);
      const parsed=new URL(source);
      if(parsed.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org'].includes(parsed.hostname))continue;
      const image=await fetch(parsed,{headers,signal:AbortSignal.timeout(3500),redirect:'error'});
      const type=image.headers.get('content-type');
      if(!image.ok||!type?.startsWith('image/'))continue;
      caches.set(key,{url:source,expiry:Date.now()+3600000});
      return new Response(image.body,{headers:{'content-type':type,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
    }catch{ /* Try the next verified image route. */ }
  }
  return json({error:'The photo could not load. Use the clues or void the round.'},502);
}
