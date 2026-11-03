export const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export const copy = (v) => JSON.parse(JSON.stringify(v));
export function shuffled(items, rng = Math.random) { const a = [...items]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a; }
export function makePack(catalog, history = [], count = 15, rng = Math.random, campus = true, mix = null) {
  const allowed=catalog.filter(q=>campus||q.category!=='campus');
  const lastSeen=new Map();
  history.slice(-6).forEach((session,index)=>session.entities.forEach(entity=>lastSeen.set(entity,index)));
  const recent=new Set(lastSeen.keys());
  const fresh=shuffled(allowed.filter(q=>!recent.has(q.entity)),rng);
  const old=shuffled(allowed.filter(q=>recent.has(q.entity)),rng).sort((a,b)=>lastSeen.get(a.entity)-lastSeen.get(b.entity));
  const pool=[...fresh,...old], out=[], used=new Set();
  const remaining=mix?{...mix}:null;
  let previousCategory='', previousStyle='', previousPortraitGroup='',previousImageRegion='';
  while(out.length<count){
    const candidates=pool.filter(q=>!used.has(q.entity)&&(!remaining||remaining[q.category]>0)); if(!candidates.length)break;
    const oldest=lastSeen.get(candidates[0].entity);
    const eligible=candidates.filter(q=>lastSeen.get(q.entity)===oldest);
    const first=eligible.find(q=>q.category!==previousCategory)||eligible[0];
    const alternatives=eligible.filter(q=>q.category===first.category);
    const balanced=first.portraitGroup&&first.portraitGroup===previousPortraitGroup
      ?alternatives.filter(q=>q.portraitGroup&&q.portraitGroup!==previousPortraitGroup)
      :[];
    const options=balanced.length?balanced:alternatives;
    const q=options.find(q=>!q.imageRegion||q.imageRegion!==previousImageRegion)||options[0];
    if(q.portraitGroup)previousPortraitGroup=q.portraitGroup;
    if(q.imageRegion)previousImageRegion=q.imageRegion;
    const styles=q.image?['scratch','tiles','zoom']:['clues'];
    const style=shuffled(styles.filter(s=>s!==previousStyle),rng)[0]||styles[0];
    out.push({...copy(q),style});used.add(q.entity);if(remaining)remaining[q.category]--;previousCategory=q.category;previousStyle=style;
  }
  return {questions:out,cooldownRelaxed:out.some(q=>recent.has(q.entity))};
}
export function createRoom({code,hostHash,playerHash,nickname,pack,now,settings={}}) {
  return {code,hostHash,createdAt:now,expiresAt:now+8*3600000,revision:0,phase:'lobby',index:-1,deadline:null,paused:false,remaining:0,questions:pack.questions,cooldownRelaxed:pack.cooldownRelaxed,settings:{seconds:Math.max(15,Math.min(90,Number(settings.seconds)||30)),auto:settings.auto!==false,speedBonus:settings.speedBonus===true},players:[{id:crypto.randomUUID(),tokenHash:playerHash,nickname:nickname||'Anfitrión',joinedAt:now}],answers:{},audit:[],voided:[]};
}
const countdownMs=room=>room.questions[room.index]?.image||room.questions[room.index]?.media?11000:4000;
export function step(room, now) {
  if(room.paused||room.phase==='lobby'||room.phase==='finished')return false;
  let changed=false;
  while(room.deadline<=now&&room.phase!=='finished'){
    const at=room.deadline;
    if(room.phase==='countdown'){room.phase='question';room.deadline=at+room.settings.seconds*1000;}
    else if(room.phase==='question'){room.phase='reveal';room.deadline=room.settings.auto?at+10000:null;}
    else if(room.phase==='reveal'){
      if(!room.settings.auto||room.deadline===null)break;
      if(room.index+1>=room.questions.length){room.phase='finished';room.finishedAt??=at;room.deadline=null;}
      else {room.index++;room.phase='countdown';room.deadline=at+countdownMs(room);}
    }
    changed=true;if(room.deadline===null)break;
  }
  return changed;
}
function answerSimilarity(answer, value, exact){
  const expected=normalize(answer), entered=normalize(value);
  if(!entered)return 0;
  if(expected===entered)return 1;
  if(exact||expected.length<6||entered.length<5||/\d/.test(expected+entered))return 0;
  const limit=Math.floor(Math.max(expected.length,entered.length)*0.3);
  if(Math.abs(expected.length-entered.length)>limit)return 0;
  let row=Array.from({length:entered.length+1},(_,i)=>i);
  for(let i=0;i<expected.length;i++){
    const next=[i+1];
    for(let j=0;j<entered.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(expected[i]!==entered[j])));
    row=next;
  }
  return 1-row[entered.length]/Math.max(expected.length,entered.length);
}
export function score(question, values) {
  const parts=question.parts.map((part,i)=>{
    const value=String(values[i]??'').slice(0,100);
    const strict=!!part.choices||/country|territory|pa[ií]s/i.test(part.label);
    const similarity=Math.max(0,...part.answers.map(answer=>answerSimilarity(answer,value,strict)));
    const credit=similarity>=.85?1:similarity>=.7?similarity:0;
    return {label:part.label,value,correct:credit===1,points:credit*100/question.parts.length};
  });
  return {parts,points:parts.reduce((s,p)=>s+p.points,0)};
}
export function submit(room, playerId, questionId, values, now) {
  if(room.paused||room.phase!=='question'||now>=room.deadline)throw new Error('This round is closed. Your connection may have been delayed.');
  const q=room.questions[room.index];if(q.id!==questionId)throw new Error('The round changed. Please check the current question.');
  const key=q.id+':'+playerId;
  if(room.answers[key])return room.answers[key];
  const result={...score(q,values),questionId:q.id,playerId,receivedAt:now};room.answers[key]=result;return result;
}
export function control(room, action, payload, now) {
  if(action==='start') {if(room.phase!=='lobby')throw new Error('Session already started.');room.index=0;room.phase='countdown';room.deadline=now+countdownMs(room);}
  else if(action==='pause') {if(['lobby','finished'].includes(room.phase))return;room.paused=!room.paused;if(room.paused){room.remaining=room.deadline===null?null:Math.max(0,room.deadline-now);}else{room.deadline=room.remaining===null?null:now+room.remaining;}}
  else if(action==='next') {if(room.phase!=='reveal')throw new Error('Reveal this round before continuing.');if(room.index+1>=room.questions.length){room.phase='finished';room.finishedAt??=now;room.deadline=null;}else{room.index++;room.phase='countdown';room.deadline=now+countdownMs(room);}room.paused=false;}
  else if(action==='reveal') {if(!['question','countdown'].includes(room.phase))throw new Error('No question to reveal.');room.phase='reveal';room.deadline=room.settings.auto?now+10000:null;room.paused=false;}
  else if(action==='void') {if(room.index<0)throw new Error('No active round.');const id=room.questions[room.index].id;if(!room.voided.includes(id))room.voided.push(id);room.audit.push({action,questionId:id,reason:String(payload.reason||'Media or question problem').slice(0,200),at:now});room.phase='reveal';room.deadline=room.settings.auto?now+10000:null;room.paused=false;}
  else if(action==='adjust') {if(room.phase!=='reveal')throw new Error('Corrections are available after reveal.');const q=room.questions[room.index];const key=q.id+':'+payload.playerId;const existing=room.answers[key];if(!existing)throw new Error('This player did not submit an answer.');const part=Number(payload.part);if(!Number.isInteger(part)||!existing.parts[part])throw new Error('Unknown answer part.');if(!String(payload.reason||'').trim())throw new Error('Add a reason for the correction.');existing.parts[part].correct=!!payload.correct;existing.parts[part].points=payload.correct?100/existing.parts.length:0;existing.points=existing.parts.reduce((s,p)=>s+p.points,0);room.audit.push({action,playerId:payload.playerId,part,questionId:q.id,correct:!!payload.correct,reason:String(payload.reason).slice(0,200),at:now});}
  else if(action==='finish') {room.phase='finished';room.finishedAt??=now;room.deadline=null;room.paused=false;}
  else throw new Error('Unknown host action.');
}
export function snapshot(room, playerId, host=false, now=Date.now()) {
  const q=room.questions[room.index];const revealed=['reveal','finished'].includes(room.phase);
  const visibleIds=new Set(room.questions.slice(0,room.index+(revealed?1:0)).map(q=>q.id));
  const answers=Object.values(room.answers);
  const bonuses=new Map();
  if(room.settings.speedBonus){
    for(const id of visibleIds){
      const fastest=answers.filter(a=>a.questionId===id&&a.parts.every(p=>p.correct)).sort((a,b)=>a.receivedAt-b.receivedAt);
      fastest.forEach(answer=>{
        const position=fastest.findIndex(other=>other.receivedAt===answer.receivedAt);
        if(position<3)bonuses.set(answer,[15,10,5][position]);
      });
    }
  }
  const pointsFor=answer=>answer.points+(bonuses.get(answer)||0);
  const leaderboard=room.players.map(p=>({id:p.id,nickname:p.nickname,points:Math.round(answers.filter(a=>a.playerId===p.id&&visibleIds.has(a.questionId)&&!room.voided.includes(a.questionId)).reduce((s,a)=>s+pointsFor(a),0))})).sort((a,b)=>b.points-a.points||a.nickname.localeCompare(b.nickname));
  let rank=0,last=null;leaderboard.forEach((p,i)=>{if(p.points!==last)rank=i+1;p.rank=rank;last=p.points;});
  const mine=q?room.answers[q.id+':'+playerId]:null;
  const question=q?{id:q.id,category:q.category,prompt:q.prompt,hints:q.hints,style:q.style,hasImage:!!q.image,media:q.media?{kind:q.media.kind}:null,parts:q.parts.map(p=>({label:p.label,placeholder:p.placeholder,choices:p.choices})),...(revealed?{portrait:!!q.image?.portrait,explanation:q.explanation,source:q.source,credit:q.credit,answers:q.parts.map(p=>p.answers[0]),voided:room.voided.includes(q.id)}:{})}:null;
  return {code:room.code,phase:room.phase,index:room.index,total:room.questions.length,deadline:room.deadline,serverNow:now,paused:room.paused,remaining:room.remaining,settings:room.settings,hasSongs:room.questions.some(item=>!!item.media),question,leaderboard,playerId,isHost:host,submitted:!!mine,receipt:mine?{receivedAt:mine.receivedAt,...(revealed?{parts:mine.parts,points:pointsFor(mine),speedBonus:bonuses.get(mine)||0}:{})}:null,answerCount:q?Object.values(room.answers).filter(a=>a.questionId===q.id).length:0,cooldownRelaxed:room.cooldownRelaxed,...(host&&revealed&&q?{responses:Object.values(room.answers).filter(a=>a.questionId===q.id),audit:room.audit}:{}),...(room.phase==='finished'?{finishedAt:room.finishedAt??null,createdAt:room.createdAt,recap:room.questions.map(q=>({prompt:q.prompt,answers:q.parts.map(p=>p.answers[0]),explanation:q.explanation,source:q.source,voided:room.voided.includes(q.id)}))}:{})};
}
