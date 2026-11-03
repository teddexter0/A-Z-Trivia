import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoom,makePack,score,submit,step,control,snapshot} from '../src/engine.mjs';
import {importChorus,publicChorusSelection} from '../src/chorus.mjs';
import {MemoryStore} from '../src/storage.mjs';
import {makeApi} from '../src/api.mjs';
const catalog=JSON.parse(await readFile(new URL('../src/catalog.json',import.meta.url)));
const song=importChorus({title:'Test Song',artist:'Test Artist',youtubeVideoId:'abcdefghijk',loops:[{start:30,end:45}]} )[0];
const room=()=>createRoom({code:'123456',hostHash:'host',playerHash:'player',nickname:'Alex',pack:{questions:[song,catalog[0]],cooldownRelaxed:false},now:0,settings:{seconds:30,auto:true}});
test('artist-only answers receive exactly half credit; names tolerate accents and punctuation',()=>{assert.equal(score(song,['','Test Artist']).points,50);assert.equal(score(catalog.find(q=>q.id==='person-iniesta'),['ANDRES INIESTA','Spain']).points,100);});
test('replayed submissions cannot overwrite a first answer or award points twice',()=>{const r=room();control(r,'start',{},0);step(r,14000);const a=submit(r,r.players[0].id,song.id,['wrong','Test Artist'],15000);const b=submit(r,r.players[0].id,song.id,['Test Song','Test Artist'],15500);assert.deepEqual(a,b);assert.equal(Object.keys(r.answers).length,1);assert.equal(a.points,50);});
test('server rejects paused, late and stale-question submissions',()=>{const r=room();control(r,'start',{},0);step(r,14000);assert.throws(()=>submit(r,r.players[0].id,'old',['x'],15000),/round changed/);control(r,'pause',{},16000);assert.throws(()=>submit(r,r.players[0].id,song.id,['x'],17000),/closed/);control(r,'pause',{},19000);assert.throws(()=>submit(r,r.players[0].id,song.id,['x'],50000),/closed/);});
test('same correct answers submitted at different speeds earn identical points and tied ranks',()=>{const r=room();r.players.push({id:'second',nickname:'Other',tokenHash:'second'});control(r,'start',{},0);step(r,14000);submit(r,r.players[0].id,song.id,['Test Song','Test Artist'],15000);submit(r,'second',song.id,['Test Song','Test Artist'],40000);step(r,44000);const s=snapshot(r,'second',false,44000);assert.equal(s.leaderboard[0].points,100);assert.equal(s.leaderboard[1].points,100);assert.deepEqual(s.leaderboard.map(p=>p.rank),[1,1]);});
test('current answers, answer keys, tokens and other submissions are absent before reveal',()=>{const r=room();control(r,'start',{},0);step(r,14000);submit(r,r.players[0].id,song.id,['Test Song','Test Artist'],15000);const s=snapshot(r,r.players[0].id,true,15000);assert.equal(s.question.answers,undefined);assert.equal(s.question.explanation,undefined);assert.equal(s.question.media.videoId,undefined);assert.equal(s.responses,undefined);assert.equal(s.receipt.points,undefined);assert.equal(s.receipt.parts,undefined);assert.equal(s.hostHash,undefined);assert.equal(s.leaderboard[0].tokenHash,undefined);assert.equal(s.leaderboard[0].points,0);});
test('voiding a round removes all its points, including after an accepted correction',()=>{const r=room();control(r,'start',{},0);step(r,14000);submit(r,r.players[0].id,song.id,['wrong','Test Artist'],15000);control(r,'reveal',{},16000);control(r,'adjust',{playerId:r.players[0].id,part:0,correct:true,reason:'Recognised alias'},16100);assert.equal(snapshot(r,r.players[0].id,true,16100).leaderboard[0].points,100);control(r,'void',{reason:'Audio failed'},16200);assert.equal(snapshot(r,r.players[0].id,true,16200).leaderboard[0].points,0);assert.equal(r.audit.length,2);});
test('corrections require a reason and are unavailable before reveal',()=>{const r=room();control(r,'start',{},0);step(r,14000);submit(r,r.players[0].id,song.id,['x','x'],15000);assert.throws(()=>control(r,'adjust',{},15100),/after reveal/);control(r,'reveal',{},16000);assert.throws(()=>control(r,'adjust',{playerId:r.players[0].id,part:0,correct:true},16100),/reason/);});
test('automatic progression catches up to server time and finishes; manual reveal stays put',()=>{const r=room();control(r,'start',{},0);step(r,110000);assert.equal(r.phase,'finished');const manual=room();manual.settings.auto=false;control(manual,'start',{},0);step(manual,50000);assert.equal(manual.phase,'reveal');step(manual,100000);assert.equal(manual.index,0);});
test('packs exclude repeated entities and fresh pools honor cross-session cooldown',()=>{const h=[{entities:catalog.slice(0,15).map(q=>q.entity)}],p=makePack(catalog,h,15);assert.equal(new Set(p.questions.map(q=>q.entity)).size,15);assert.ok(p.questions.every(q=>!h[0].entities.includes(q.entity)));assert.equal(p.cooldownRelaxed,false);const small=makePack(catalog,h,catalog.length);assert.equal(small.cooldownRelaxed,true);});
test('real Chorus Clip loops preserve timestamps, per-loop video overrides and aliases',()=>{const qs=importChorus({clips:[{title:'Song',artist:'Artist',youtubeVideoId:'abcdefghijk',titleAliases:['Alias'],loops:[{start:12.5,end:25,youtubeVideoId:'lmnopqrstuv',loopCount:0}]}]});assert.deepEqual(qs[0].media,{kind:'youtube',videoId:'lmnopqrstuv',start:12.5,end:25});assert.equal(score(qs[0],['Alias','Artist']).points,100);});
test('invalid media imports fail instead of silently guessing a chorus',()=>{assert.throws(()=>importChorus({title:'x',artist:'y',youtubeVideoId:'abcdefghijk'}),/valid 1/);assert.throws(()=>importChorus({title:'x',artist:'y',youtubeVideoId:'bad',loops:[{start:0,end:10}]}),/video ID/);});
test('public share imports never revive a private clip from stale playlist metadata',async()=>{const encode=v=>typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{doubleValue:v}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,v])=>[k,encode(v)]))}};const document=data=>new Response(JSON.stringify({fields:encode(data).mapValue.fields}));const fake=async url=>url.includes('/publicPlaylists/')?document({clips:[{id:'private'},{id:'public'}]}):url.endsWith('/private')?document({isPublic:false,title:'Private song',artist:'Private artist',youtubeVideoId:'abcdefghijk',loops:[{start:0,end:10}]}):document({isPublic:true,title:'Artist - Song (Official Video)',artist:'Artist',youtubeVideoId:'abcdefghijk',loops:[{start:5,end:20}]});const q=await publicChorusSelection('https://chorus-clip.vercel.app/?playlist=test',fake);assert.equal(q.length,1);assert.equal(q[0].parts[0].answers[0],'Song');await assert.rejects(publicChorusSelection('https://evil.test/?clip=x',fake),/share link/);});
test('catalog includes no school logo; image lookup is restricted to reviewed Wikipedia entries',()=>{assert.ok(catalog.some(q=>q.category==='culture'));assert.ok(catalog.filter(q=>q.image).every(q=>typeof q.image.wiki==='string'&&!q.image.wiki.toLowerCase().includes('logo')));for(const q of catalog){assert.ok(q.source.startsWith('https://'));for(const p of q.parts){assert.ok(p.answers.length);if(p.choices)assert.ok(p.choices.includes(p.answers[0]));}}});
async function setupApi(Store=MemoryStore){const store=new Store(),api=makeApi({store,catalog,local:true});const call=async(path,body,token)=>{const r=await api(new Request('https://club.test'+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}));return {status:r.status,body:await r.json()};};const created=await call('/api/rooms',{nickname:'Host',count:5,categories:['phrases']});return {store,call,created:created.body};}
test('full API flow: nickname join, private host controls, server grading and export',async()=>{const {store,call,created:c}=await setupApi();const base='/api/rooms/'+c.code;const guest=await call(base+'/join',{nickname:'Alex'});assert.equal(guest.status,200);const player=guest.body.playerToken;assert.equal((await call(base+'/control',{action:'start'},player)).status,403);assert.equal((await call(base+'/state',null,'fake')).status,401);await call(base+'/control',{action:'start'},c.hostToken);let row=await store.get(c.code);row.room.phase='question';row.room.deadline=Date.now()+30000;await store.cas(c.code,row.room,row.revision);const q=row.room.questions[0];const answer=await call(base+'/answer',{questionId:q.id,values:q.parts.map(p=>p.answers[0])},player);assert.equal(answer.body.submitted,true);assert.equal(answer.body.receipt.points,undefined);await call(base+'/control',{action:'reveal'},c.hostToken);const revealed=await call(base+'/state',null,player);assert.equal(revealed.body.receipt.points,100);assert.equal(revealed.body.responses,undefined);await call(base+'/control',{action:'finish'},c.hostToken);assert.equal((await call(base+'/export',null,c.hostToken)).status,200);assert.equal((await call(base+'/export',null,player)).status,403);});
test('concurrent compare-and-swap retries preserve joins without consuming the request twice',async()=>{class ConflictStore extends MemoryStore{failOnce=true;async cas(...args){if(this.failOnce){this.failOnce=false;return false;}return super.cas(...args);}}const {call,created:c}=await setupApi(ConflictStore);const result=await call('/api/rooms/'+c.code+'/join',{nickname:'Retry guest'});assert.equal(result.status,200);assert.equal(result.body.state.leaderboard.length,2);});
test('duplicate nicknames and cross-origin mutations are rejected',async()=>{const {call,created:c}=await setupApi();assert.equal((await call('/api/rooms/'+c.code+'/join',{nickname:'host'})).status,409);assert.equal((await call('/api/rooms/'+c.code+'/join',{nickname:'  H\u00f3st\u200b  '})).status,409);const api=makeApi({store:new MemoryStore(),catalog});const r=await api(new Request('https://club.test/api/rooms',{method:'POST',headers:{origin:'https://elsewhere.test'},body:'{}'}));assert.equal(r.status,403);});

test('late arrivals join active rooms and can submit; finished rooms reject new players',async()=>{
  const {call,created,store}=await setupApi();
  const path='/api/rooms/'+created.code;
  await call(path+'/control',{action:'start'},created.hostToken);
  const late=await call(path+'/join',{nickname:'Late player'});
  assert.equal(late.status,200);
  const row=await store.get(created.code);
  row.room.phase='question';
  row.room.deadline=Date.now()+30000;
  await store.cas(created.code,row.room,row.revision);
  const q=row.room.questions[0];
  assert.equal((await call(path+'/answer',{questionId:q.id,values:q.parts.map(p=>p.answers[0])},late.body.playerToken)).status,200);
  await call(path+'/control',{action:'finish'},created.hostToken);
  assert.equal((await call(path+'/join',{nickname:'Too late'})).status,409);
});
test('speed bonus uses correct-answer receipt order and leaves partial credit intact',()=>{
  const game=room();
  game.settings.speedBonus=true;
  game.phase='question';
  game.index=0;
  game.deadline=10000;
  const host=game.players[0].id;
  game.players.push({id:'early',nickname:'Early'},{id:'partial',nickname:'Partial'});
  submit(game,'partial',song.id,['','Test Artist'],100);
  submit(game,'early',song.id,['Test Song','Test Artist'],200);
  submit(game,host,song.id,['Test Song','Test Artist'],300);
  assert.equal(snapshot(game,host).receipt.speedBonus,undefined);
  game.phase='reveal';
  assert.deepEqual(snapshot(game,host).leaderboard.map(p=>p.points),[115,110,50]);
  assert.equal(snapshot(game,host).receipt.speedBonus,10);
});

test('media rounds get seven extra buffer seconds without shortening answers',()=>{
  const game=room();
  control(game,'start',{},0);
  assert.equal(game.deadline,11000);
  step(game,11000);
  assert.equal(game.deadline,41000);
  const textOnly=room();
  textOnly.questions=[{...song,media:null}];
  control(textOnly,'start',{},0);
  assert.equal(textOnly.deadline,4000);
});
test('typed names accept typos while choices, countries and years remain exact',()=>{
  assert.equal(score(song,['Test Sng','Test Artst']).points,100);
  assert.equal(score(song,['xxx','Test Artst']).points,50);
  const strict={parts:[{label:'Country',answers:['Colombia']},{label:'Year',answers:['2025']},{label:'Pick',answers:['Granada'],choices:['Grenada','Granada']}]};
  assert.equal(score(strict,['Columbia','2026','Grenada']).points,0);
});

test('fresh image entities take priority and repeats start with the oldest session',()=>{
  const faces=catalog.filter(q=>q.category==='faces').slice(0,4);
  const history=[{entities:[faces[1].entity]},{entities:[faces[2].entity,faces[3].entity]}];
  const pack=makePack(faces,history,4,()=>0.5);
  assert.deepEqual(pack.questions.slice(0,2).map(q=>q.entity),faces.slice(0,2).map(q=>q.entity));
});
