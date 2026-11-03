import { createRoom, makePack, step, snapshot, submit, control, shuffled } from './engine.mjs';
import { importChorus, publicChorusSelection } from './chorus.mjs';
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const token=()=>crypto.randomUUID()+crypto.randomUUID();
const digest=async(v)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const auth=(req)=>req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
const nickname=v=>String(v||'').trim().slice(0,24).replace(/[<>\x00-\x1f]/g,'');
const caches=new Map();
export function makeApi({store,catalog,config={},local=false}) {
  return async function api(req) {
    const url=new URL(req.url),path=url.pathname;
    try{
      if(req.method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'Origin mismatch.'},403);
      if(path==='/api/config')return json({firebase:config.firebase||null,transport:config.transport||(local?'sse':'poll'),catalogCount:catalog.length,storage:local?'local-file':'durable-server',version:'1.0.0'});
      if(path==='/api/rooms'&&req.method==='POST') {
        const body=await readBody(req);const name=nickname(body.nickname);if(!name)return json({error:'Choose a host nickname.'},400);
        if(config.firebase?.apiKey&&!local){const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(config.firebase.apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:body.firebaseToken})});if(!r.ok)return json({error:'Guest identity expired. Reload and try again.'},401);}
        const history=await store.history();let imported=[];if(body.chorus)imported=importChorus(body.chorus);const playlist=body.chorusUrl||config.chorusPlaylist;if(playlist)imported.push(...await publicChorusSelection(playlist));
        const enabled=Array.isArray(body.categories)?body.categories:['faces','places','phrases','campus','music'];
        const pool=[...catalog,...imported].filter(q=>enabled.includes(q.category));if(!pool.length)return json({error:'Select a category with available questions.'},400);
        const count=Math.max(5,Math.min(25,Number(body.count)||15));
        const pack=makePack(pool,history,count);
        const songs=pool.filter(q=>q.category==='music');
        if(songs.length&&!pack.questions.some(q=>q.category==='music')){
          const musicPack=makePack(songs,history,1);
          pack.questions.splice(Math.floor(pack.questions.length/2),1,musicPack.questions[0]);
          pack.cooldownRelaxed ||= musicPack.cooldownRelaxed;
        }
        pack.questions.forEach(q=>q.parts.forEach(p=>{if(p.choices)p.choices=shuffled(p.choices);}));
        const hostToken=token(),playerToken=token();let room;
        for(let i=0;i<5;i++){const digits=new Uint32Array(1);crypto.getRandomValues(digits);const code=String(100000+(digits[0]%900000));room=createRoom({code,hostHash:await digest(hostToken),playerHash:await digest(playerToken),nickname:name,pack,now:Date.now(),settings:body});try{await store.insert(room);break;}catch(e){if(i===4)throw e;}}
        return json({code:room.code,hostToken,playerToken,state:snapshot(room,room.players[0].id,true)},201);
      }
      const m=path.match(/^\/api\/rooms\/(\d{6})(?:\/(join|state|answer|control|media|image|export))?$/);
      if(!m)return json({error:'Not found.'},404);
      const [,code,operation='state']=m;
      if(operation==='image')return await imageResponse(code,req,url,store,catalog);
      const raw=auth(req);const hash=raw?await digest(raw):'';
      let result;
      for(let attempt=0;attempt<8;attempt++) {
        const row=await store.get(code);if(!row||row.room.expiresAt<Date.now())return json({error:'This room is unavailable or expired.'},404);
        const room=row.room,now=Date.now();let changed=step(room,now);const host=hash===room.hostHash;let player=room.players.find(p=>p.tokenHash===hash);
        if(operation==='join'&&req.method==='POST') {
          const body=await readBody(req);const name=nickname(body.nickname);if(!name)return json({error:'Enter a nickname.'},400);
          if(room.phase==='finished')return json({error:'This session has ended. Ask the host for the next room code.'},409);
          if(room.players.length>=50)return json({error:'This room is full (50 players).'},409);
          if(room.players.some(p=>p.nickname.toLowerCase()===name.toLowerCase()))return json({error:'That nickname is taken. Try another.'},409);
          const playerToken=token();player={id:crypto.randomUUID(),nickname:name,tokenHash:await digest(playerToken),joinedAt:now};room.players.push(player);changed=true;
          result={code,playerToken,state:snapshot(room,player.id,false,now)};
        }else {
          if(!host&&!player)return json({error:'Rejoin with your room code and nickname.'},401);
          if(host&&!player)player=room.players[0];
          if(operation==='answer'&&req.method==='POST') {const body=await readBody(req);if(!Array.isArray(body.values)||body.values.length>3||body.values.some(v=>typeof v!=='string'||v.length>100))return json({error:'Invalid answer.'},400);submit(room,player.id,body.questionId,body.values,now);changed=true;}
          else if(operation==='control'&&req.method==='POST'){if(!host)return json({error:'Host controls are private.'},403);const body=await readBody(req);control(room,body.action,body,now);changed=true;}
          else if(operation==='media') {if(!host)return json({error:'Playback is on the host device.'},403);const q=room.questions[room.index];return json(q?.media&&['question','reveal'].includes(room.phase)?q.media:null);}
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
async function imageResponse(code,req,url,store){
  const row=await store.get(code);if(!row||row.room.expiresAt<Date.now())return json({error:'Room expired.'},404);
  const hash=await digest(auth(req));if(!row.room.players.some(p=>p.tokenHash===hash)&&row.room.hostHash!==hash)return json({error:'Join this room first.'},401);
  step(row.room,Date.now());const q=row.room.questions[row.room.index];if(url.searchParams.has('question')&&url.searchParams.get('question')!==q?.id)return json({error:'The question changed.'},409);if(!q?.image||!['question','reveal'].includes(row.room.phase))return json({error:'No active image.'},404);
  const key=q.image.wiki;let cached=caches.get(key);
  if(!cached||cached.expiry<Date.now()){
    const endpoint='https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=original&pilicense=free&titles='+encodeURIComponent(key);
    const r=await fetch(endpoint,{headers:{'User-Agent':'LaRondaClubTrivia/1.0 (educational club game)'}});if(!r.ok)throw new Error('Photo unavailable. The host can void this round.');const data=await r.json();const page=Object.values(data.query?.pages||{})[0];const source=page?.original?.source;if(!source||new URL(source).hostname!=='upload.wikimedia.org')throw new Error('No freely licensed photo available.');
    cached={url:source,expiry:Date.now()+3600000};caches.set(key,cached);
  }
  const image=await fetch(cached.url);if(!image.ok)throw new Error('Photo could not load.');return new Response(image.body,{headers:{'content-type':image.headers.get('content-type')||'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
}
