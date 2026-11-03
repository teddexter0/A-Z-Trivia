const BASE=location.pathname.startsWith('/la-ronda')?'/la-ronda':'';
const fetch=(input,options)=>window.fetch(typeof input==='string'&&input.startsWith('/api/')?BASE+input:input,options);
const $=s=>document.querySelector(s), app=$('#app');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config={},session=null,state=null,offset=0,view='home',signature='',pollTimer,streamAbort,sound=false,imageUrl='',imageKey='',drafts={},roomConnection=0,photoRequest=null;
const labels={faces:'Famous faces',places:'Places',music:'Guess the song',phrases:'Spanish phrases',culture:'Countries, history & culture',campus:'Spanish Club on campus'};
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),5000);}
async function request(path,body,token=session?.hostToken||session?.playerToken){const r=await fetch(path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await r.json();}catch{throw new Error('The server is unavailable. Your submitted answer will not be resent as a new attempt.');}if(!r.ok)throw Object.assign(new Error(data.error||'Request failed.'),{status:r.status});return data;}
function home(){view='home';app.innerHTML=`<div class="hero"><section><div class="pill"><span class="dot"></span> FUN SPANISH TRIVIA</div><h1>Know the answer?<br><em>Prove it.</em></h1><p class="intro">Famous faces. Faraway places. That chorus everyone knows. One room, a little friendly rivalry, and a whole lot of español.</p><form id="join" class="join-card"><h3>Get in on the round.</h3><label>Your nickname<input name="nickname" placeholder="e.g. Alex" maxlength="24" required autocomplete="nickname"></label><div class="field-row"><label style="flex:1">Room code<input class="code-input" name="code" placeholder="000000" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required value="${esc(new URL(location.href).searchParams.get('room')||'')}"></label><button class="btn" type="submit">Join ↗</button></div></form><div class="host-link"><button class="text-button" data-action="winner-history">Winner history</button><span>Bringing the club together?</span><button class="text-button" data-action="setup">Host a round ↗</button></div>${session?'<button class="btn secondary spaced" data-action="resume">Return to room '+esc(session.code)+' ↗</button>':''}<div class="strip"><span>No player accounts</span><span>Automatic scores</span><span>Everyone gets a shot</span></div></section><div class="visual" aria-hidden="true"><div class="orbit"></div><div class="poster"><div class="poster-label"><span>LA RONDA / VOL. 01</span><span>JUEVES</span></div><div class="poster-title">A little<br>mystery.<br><em>Mucho juego.</em></div><div class="arch"></div></div><div class="sticker one">¿Quién es? ↗</div><div class="sticker two"><span class="mini-bars"><i></i><i></i><i></i><i></i></span>Wait… I know this one.</div><div class="sticker three">50 for the artist. Still counts. &#127466;&#127480;</div></div></div>`;}
function setup(){view='setup';app.innerHTML=`<section class="setup"><div class="section-top"><div><div class="eyebrow">HOST LESS. PLAY MORE.</div><h2>Make it a good Thursday.</h2></div><button class="btn secondary small" data-action="home">← Back</button></div><p class="intro">Pick the mix. We’ll take care of the turns, the reveals and the scores. You get to join in.</p><form id="create"><div class="setup-grid"><div class="panel"><h3>The room</h3><label>Your playing nickname<input name="nickname" autocomplete="nickname" maxlength="24" required></label><div class="field-row"><label style="flex:1">Questions<select name="count"><option>10</option><option selected>15</option><option>20</option><option>25</option></select></label><label style="flex:1">Seconds per question<select name="seconds"><option value="20">20 seconds</option><option value="30" selected>30 seconds</option><option value="45">45 seconds</option><option value="60">60 seconds</option></select></label></div><label class="check"><input type="checkbox" name="auto" checked> Advance automatically</label><p class="muted spaced" style="font-size:15px">Everyone within the answer window earns equal points. Ties stay tied. Connection speed isn’t a skill.</p></div><div class="panel"><h3>The mix</h3><div class="checks">${Object.entries(labels).map(([id,label])=>`<label class="check"><input type="checkbox" name="category" value="${id}" checked>${label}</label>`).join('')}</div><label class="spaced">Chorus Clip playlist (optional)<input id="chorus-link" name="chorusUrl" type="url" placeholder="Paste your playlist share link"></label><p class="muted">We’ll load the songs when you start. This browser remembers your link for next time.</p></div></div><div class="setup-actions"><span class="muted" style="font-size:15px">The room expires after 8 hours. Save your results at the end.</span><button class="btn orange" type="submit">Create my room ↗</button></div></form></section>`;$('#chorus-link').value=localStorage.getItem('ronda-chorus-link')||'';
 if(state?.code===session?.code)$('#create input[name=nickname]').value=state?.leaderboard.find(p=>p.id===state.playerId)?.nickname||'';}
function persist(){localStorage.setItem('ronda-session',JSON.stringify(session));}
function accept(next){if(view!=='room'||next.code!==session?.code)return;const before=state;state=next;if(next.isHost&&next.phase==='finished')saveWinner(next);offset=next.serverNow-Date.now();const sig=JSON.stringify([next.code,next.phase,next.index,next.paused,next.submitted,next.leaderboard,next.responses?.map(r=>[r.playerId,r.points]),next.question?.voided]);if(view!=='room'||sig!==signature){signature=sig;renderRoom();if(before&&before.phase!==next.phase&&next.phase==='reveal')beep();}syncChorus(next);updateLive();}
function stopConnection(){stopChorus();roomConnection++;liveConnection?.close();liveConnection=null;clearTimeout(pollTimer);streamAbort?.abort();}
async function connect(){stopConnection();signature='';view='room';try{accept(await request('/api/rooms/'+session.code+'/state'));if(config.transport==='websocket')liveSocket();else if(config.transport==='sse')stream();else poll();}catch(e){toast(e.message);home();}}
async function poll(){const connection=roomConnection;try{const next=await request('/api/rooms/'+session.code+'/state');if(connection!==roomConnection)return;accept(next);$('.connection')?.classList.remove('bad');if($('.connection'))$('.connection').textContent='● Connected · server clock';}catch(e){if($('.connection')){$('.connection').classList.add('bad');$('.connection').textContent='Reconnecting… answers need server receipt';}}if(connection===roomConnection&&view==='room'&&state?.phase!=='finished')pollTimer=setTimeout(poll,850);}
async function stream(){streamAbort=new AbortController();try{const r=await fetch('/api/rooms/'+session.code+'/events',{headers:{authorization:'Bearer '+(session.hostToken||session.playerToken)},signal:streamAbort.signal});if(!r.ok)throw new Error('Realtime unavailable');const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(view==='room'){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(line)accept(JSON.parse(line));}}}catch(e){if(e.name==='AbortError')return;}if(view==='room')poll();}
function board(s){return `<aside class="board"><h3>${s.phase==='lobby'?'The room':'Leaderboard'}</h3><p class="muted" style="font-size:14px">${s.leaderboard.length} player${s.leaderboard.length===1?'':'s'} · ties share a place</p><div class="scores">${s.leaderboard.map(p=>`<div class="score-row"><span class="rank">${s.phase==='lobby'?'·':p.rank===1&&p.points>0?'👑':p.rank}</span><div class="avatar">${esc(p.nickname.slice(0,1).toUpperCase())}</div><span class="score-name">${esc(p.nickname)}${p.id===s.playerId?' <small>(you)</small>':''}</span><span class="score-num">${p.points}</span></div>`).join('')}</div></aside>`;}
function renderRoom(){view='room';const s=state,q=s.question;const reveal=s.phase==='reveal';const link=location.origin+BASE+'/?room='+s.code;app.innerHTML=`<div class="room-top"><div><div class="eyebrow" style="margin-bottom:9px">${s.isHost?'YOU’RE HOSTING & PLAYING':'YOU’RE IN. ¡VAMOS!'}</div><span class="connection">● Connected · server clock</span></div><div><div class="meta">ROOM CODE</div><div class="room-code">${esc(s.code)}</div></div></div>${s.paused?'<div class="paused-banner">Round paused. Take a breath.</div>':''}<div class="room-grid"><div><section class="stage">${s.isHost&&s.hasSongs&&s.phase!=='finished'?'<div class="audio-shortcut"><button class="btn secondary small" data-action="audio-window">Open private audio window</button><span>Keep this window off the projector.</span></div>':''}${s.phase==='lobby'?`<div class="lobby"><div class="tag">THE MORE, THE MERRIER.</div><h2 class="spaced">Share your room</h2><div class="big-code">${s.code}</div><p class="muted">Open this link, enter a nickname, and you’re in. One connection per player; reconnect on the same device.</p><div class="lobby-link">${esc(link)}</div><button class="btn secondary spaced" data-action="copy">Copy invite link ↗</button>${s.isHost?'<p><button class="btn orange" data-action="start">Everybody here? Start the round ↗</button></p>':'<p class="pill">Waiting for the host to start…</p>'}${s.cooldownRelaxed?'<p class="muted" style="font-size:14px">Some older questions were reused because the fresh pool was too small.</p>':''}</div>`:s.phase==='finished'?finished(s):`<div class="stage-head"><span class="tag">${labels[q.category]||'LA RONDA'} · ${s.index+1} / ${s.total}</span><span class="timer" aria-label="Time remaining">—</span></div><div class="stage-body"><h2>${s.phase==='countdown'?'Prepárate…':esc(q.prompt)}</h2>${s.phase==='countdown'?`<div class="buffer-orbit" aria-hidden="true"><i></i></div><div class="countdown" aria-live="polite">3</div><p class="muted" style="text-align:center">${q.hasImage||q.media?'Getting the media ready…':'Next question coming up.'}</p>`:`${questionMedia(q,reveal)}<div class="hint"></div>${reveal?revealPanel(s):answerForm(s)}`}</div>`}</section>${s.isHost&&s.phase!=='lobby'&&s.phase!=='finished'?`<div class="host-controls"><button class="btn secondary small" data-action="pause">${s.paused?'Resume ▶':'Pause Ⅱ'}</button>${reveal?'<button class="btn orange small" data-action="next">Next round →</button>':'<button class="btn secondary small" data-action="reveal">Close & reveal</button>'}<button class="btn secondary small" data-action="void">Void this question</button><button class="btn danger small" data-action="finish">End session</button></div><p class="muted" style="font-size:13px">Void removes the round from everyone’s score. Corrections after reveal need a reason.</p>`:''}</div>${board(s)}</div>`;
 if(q?.hasImage&&['countdown','question','reveal'].includes(s.phase))loadPhoto(q.id);
 if(reveal&&q.portrait)loadPortrait(s.code,q.id);
 if(s.phase==='question'&&!s.submitted){const saved=drafts[q.id]||[];document.querySelectorAll('[data-answer-index]').forEach(input=>{input.value=saved[Number(input.dataset.answerIndex)]||'';});document.querySelectorAll('.choice').forEach(btn=>{btn.classList.toggle('selected',saved[0]===btn.dataset.value);});}
 updateLive();}
function questionMedia(q,reveal){if(q.hasImage)return '<div class="photo-wrap '+(q.category==='faces'?'portrait-frame':'')+'"><img id="question-photo" alt="Mystery photograph for this round" draggable="false"><canvas id="scratch" aria-hidden="true"></canvas><span class="photo-label">'+(reveal?'The reveal':'Watch the picture emerge…')+'</span></div>';
 if(q.media)return `<div class="music-art"><div class="disc"></div></div><p class="muted" style="text-align:center">Listen to the host’s speakers. Name either part—or both.</p>`;
 return `<div class="question-text">${esc(q.category==='phrases'?'Piensa un poquito.':'Una conexión con nuestro campus.')}</div>`;}
function answerForm(s){if(s.submitted)return '<div class="receipt">✓ Answer received.<br><span style="font-size:15px">Locked in. You’ll see your score after the reveal.</span></div>';const q=s.question;return `<form id="answer" class="answers">${q.parts[0].choices?`<div class="choice-grid">${q.parts[0].choices.map(v=>`<button type="button" class="choice" data-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>`:`<div class="answer-fields">${q.parts.map((p,i)=>`<label>${esc(p.label)}<input data-answer-index="${i}" maxlength="100" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${esc(p.placeholder||'Your answer')}"></label>`).join('')}</div>`}<div class="submit-row"><span class="muted" style="font-size:14px">One attempt · <span id="answer-count">${s.answerCount}</span> / ${s.leaderboard.length} answered</span><button class="btn" type="submit">Lock it in ↗</button></div></form>`;}
function revealPanel(s){const q=s.question;return `<div class="reveal"><div class="tag">${q.voided?'ROUND VOIDED · NO POINTS':'THE ANSWER'}</div><div id="answer-portrait"></div><div class="reveal-answer">${q.answers.map(esc).join(' <span style="color:#8d99b1">/</span> ')}</div><p class="muted">${esc(q.explanation)}</p>${s.receipt?`<div class="spaced">${s.receipt.parts.map(p=>`<div class="part-result"><div>${p.correct?'✓':'○'} ${esc(p.value||'No answer')}<br><span>${esc(p.label)}</span></div><strong>${q.voided?0:Math.round(p.points)} pts</strong></div>`).join('')}${!q.voided&&s.receipt.speedBonus?'<p>Speed bonus: +'+s.receipt.speedBonus+' pts</p>':''}</div>`:'<p class="muted spaced">No answer submitted this round.</p>'}${q.credit?`<p class="muted">${esc(q.credit)}</p>`:''}${q.source?`<a class="source" target="_blank" rel="noopener" href="${esc(q.source)}">Check the source${q.hasImage?' / photograph credits':''} ↗</a>`:''}</div>${s.isHost?corrections(s):''}`;}
function corrections(s){return `<details class="corrections"><summary>Review answers / accept a valid variant</summary>${(s.responses||[]).map(r=>`<div class="correction-row"><strong>${esc(s.leaderboard.find(p=>p.id===r.playerId)?.nickname)}</strong>${r.parts.map((p,i)=>`<div>${esc(p.label)}: “${esc(p.value||'—')}” <button class="btn secondary small" data-action="adjust" data-player="${r.playerId}" data-part="${i}" data-correct="${!p.correct}">${p.correct?'Mark incorrect':'Accept this answer'}</button></div>`).join('')}<input aria-label="Correction reason for ${esc(s.leaderboard.find(p=>p.id===r.playerId)?.nickname)}" data-reason-player="${r.playerId}" placeholder="Reason: valid alias / spelling variant…"></div>`).join('')}${s.audit?.length?'<p class="muted spaced">'+s.audit.map(a=>esc(a.reason)).join(' · ')+'</p>':''}</details>`;}
const portraits=new Map();
function loadPortrait(code,id){
  const key=code+':'+id;
  if(!portraits.has(key)){
    if(portraits.size>=32)portraits.delete(portraits.keys().next().value);
    portraits.set(key,request('/api/rooms/'+code+'/portrait?question='+encodeURIComponent(id)).catch(()=>null));
  }
  portraits.get(key).then(portrait=>{
    const target=$('#answer-portrait');
    if(!portrait||!target||state?.code!==code||state?.question?.id!==id||state?.phase!=='reveal')return;
    target.innerHTML=`<figure class="answer-portrait"><a href="${esc(portrait.link)}" target="_blank" rel="noopener"><img src="${esc(portrait.image)}" alt="Portrait of the answer" referrerpolicy="no-referrer">${esc(portrait.provider)}</a>${portrait.provider==='TMDB'?'<figcaption>This product uses the TMDB API but is not endorsed or certified by TMDB.</figcaption>':''}</figure>`;
  });
}
const celebratedRooms=new Set();
const winnerStorage='ronda-winners-v1';
const winnerDate=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
function savedWinners(){
  try{
    const data=JSON.parse(localStorage.getItem(winnerStorage)||'[]');
    return Array.isArray(data)?data:[];
  }catch{return [];}
}
function saveWinner(room){
  const key=room.code+':'+room.createdAt;
  if(saveWinner.lastKey===key)return;
  const winners=savedWinners();
  if(winners.some(row=>row.key===key)){saveWinner.lastKey=key;return;}
  const first=room.leaderboard.filter(player=>player.rank===1);
  if(!first.length)return;
  try{
    localStorage.setItem(winnerStorage,JSON.stringify([{
      key,code:room.code,finishedAt:room.finishedAt??null,
      winners:first.map(player=>player.nickname),points:first[0].points
    },...winners]));
    saveWinner.lastKey=key;
  }catch{saveWinner.lastKey=key;toast('This browser could not save winner history. You can still download scores.');}
}
function showWinnerHistory(){
  const dialog=document.createElement('dialog');
  dialog.className='winner-history';
  dialog.setAttribute('aria-label','Winner history');
  const rows=savedWinners().sort((a,b)=>(b.finishedAt||0)-(a.finishedAt||0));
  dialog.innerHTML=`<form method="dialog"><button class="btn secondary small">Close</button></form><h2>Winner history</h2><p class="muted">Completed games you hosted on this browser.</p>${rows.length?`<ol>${rows.map(row=>`<li><strong>${row.winners.map(esc).join(' &amp; ')}</strong><span>${row.points} points · Room ${esc(row.code)}</span><span>${row.finishedAt?winnerDate.format(row.finishedAt):'Finish time unavailable'}</span></li>`).join('')}</ol>`:'<p>No finished games saved yet.</p>'}`;
  document.body.append(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function celebrate(code){
  if(celebratedRooms.has(code))return;
  celebratedRooms.add(code);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const layer=document.createElement('div');
  layer.className='pinata-celebration';
  layer.setAttribute('aria-hidden','true');
  layer.innerHTML=`<div class="pinata-flash"></div><svg class="pinata-star" viewBox="0 0 200 220"><path d="M100 0v33" stroke="#fff2ce" stroke-width="3"/><path d="M100 36 121 76 165 68 154 111 191 139 144 150 137 195 100 170 61 195 55 150 9 139 46 111 35 68 79 76Z" fill="#ffcc48" stroke="#fff6d4" stroke-width="5"/><path d="m51 83 45 19 46-19-11 22-35 14-33-14zm14 41 32 13 35-13-5 20-30 13-29-13z" fill="#ec365d"/><circle cx="100" cy="119" r="13" fill="#25a96e"/></svg>`;
  const pieces=document.createDocumentFragment();
  for(let i=0;i<280;i++){
    const piece=document.createElement('i');
    const angle=(i/280)*Math.PI*2+Math.random()*.14;
    const reach=.44+Math.random()*.43;
    piece.style.cssText=`--dx:${Math.cos(angle)*reach*100}vw;--dy:${Math.sin(angle)*reach*100}vh;--hue:${[48,61,142,167,354,326,195][i%7]};--spin:${(i%2?1:-1)*(300+Math.random()*950)}deg;--delay:${.79+Math.random()*.35}s;--duration:${2.6+Math.random()*2.1}s;--size:${6+Math.random()*12}px`;
    pieces.append(piece);
  }
  layer.append(pieces);
  document.body.append(layer);
  setTimeout(()=>layer.remove(),6000);
}
function finished(s){celebrate(s.code);const top=s.leaderboard.filter(p=>p.rank===1);return `<div class="stage-body" style="padding-top:30px"><div class="eyebrow">UNA RONDA PARA RECORDAR.</div><h2>Well played!</h2><div class="featured-podium"><div class="salsa-display"><div class="salsa-steps" aria-hidden="true"><svg viewBox="0 0 144 102"><g class="dance-lead"><circle cx="41" cy="16" r="8" fill="#db9b70"/><path d="M32 12q4-12 17-4l1 7-7-5z" fill="#33211d"/><path d="M40 28l-5 28m5-24 18 8 13-9M35 34 23 44 15 35" stroke="#55f5a4" stroke-width="8" stroke-linecap="round" fill="none"/><path class="dance-legs" d="M35 54 29 71 18 89m17-35 13 16 7 19" stroke="#f7e9be" stroke-width="8" stroke-linecap="round" fill="none"/></g><g class="dance-follow"><circle cx="100" cy="16" r="8" fill="#b77251"/><path d="M92 18q-5-16 9-15 12 0 11 17l-6 1-2-11-8-1z" fill="#33211d"/><path d="m99 30 8 21m-8-17-16 6-12-9m31 2 15 8 10-12" stroke="#ff545e" stroke-width="7" stroke-linecap="round" fill="none"/><path class="dance-legs" d="M104 55l-7 18-9 15m17-32 12 16 6 16" stroke="#b77251" stroke-width="7" stroke-linecap="round" fill="none"/><path class="dance-skirt" d="M96 46q12-6 14 0l12 18q-20 10-35-1z" fill="#ffcb43"/><path d="M86 89h8m26 0h9" stroke="#ff545e" stroke-width="5" stroke-linecap="round"/></g></svg></div><span class="salsa-caption">Salsa dance</span></div><div class="trophy">&#127466;&#127480;</div><div class="tag">${top.length>1?'JOINT WINNERS':'THIS ROUND BELONGS TO'}</div><h2>${top.map(p=>esc(p.nickname)).join(' & ')}</h2><p class="muted">${top[0]?.points||0} points · everyone brought something</p>${s.finishedAt?'<p class="muted">Finished '+esc(winnerDate.format(s.finishedAt))+'</p>':''}</div><div class="host-controls">${s.isHost?'<button class="btn" data-action="export">Download scores (CSV) ↓</button>' :''}${s.isHost?'<button class="btn secondary" data-action="winner-history">Winner history</button>':''}<button class="btn secondary" data-action="setup">Play another round ↗</button></div><div class="recap">${s.recap.map(q=>`<details><summary>${esc(q.prompt)}${q.voided?' · voided':''}</summary><p style="color:var(--lime)">${q.answers.map(esc).join(' / ')}</p><p class="muted">${esc(q.explanation)}</p><a class="source" href="${esc(q.source)}" target="_blank" rel="noopener">Source ↗</a></details>`).join('')}</div></div>`;}
async function loadPhoto(id){
  const code=session.code,key=code+':'+id;
  if(imageKey!==key){if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl='';imageKey=key;}
  const current=()=>view==='room'&&session?.code===code&&state?.question?.id===id;
  const display=()=>{const photo=$('#question-photo');if(current()&&photo&&imageUrl)photo.src=imageUrl;};
  if(imageUrl){display();return;}
  if(photoRequest?.key===key)return;
  const pending={key};photoRequest=pending;
  try{
    const response=await fetch('/api/rooms/'+code+'/image?question='+encodeURIComponent(id),{headers:{authorization:'Bearer '+(session.hostToken||session.playerToken)}});
    if(!response.ok)throw new Error('Photo unavailable');
    const blob=await response.blob();
    if(!current()||imageKey!==key)return;
    imageUrl=URL.createObjectURL(blob);display();
  }catch{if(current()&&$('.photo-label'))$('.photo-label').textContent='Photo unavailable. Use the clues.';}
  finally{if(photoRequest===pending)photoRequest=null;}
}
function updateLive(){if(!state||view!=='room')return;const now=Date.now()+offset;const left=state.paused?Math.ceil((state.remaining||0)/1000):Math.max(0,Math.ceil(((state.deadline||now)-now)/1000));if($('.timer'))$('.timer').textContent=state.paused?'Ⅱ':state.deadline===null?'—':left+'s';if($('.countdown'))$('.countdown').textContent=state.paused?'Ⅱ':Math.max(1,left);if($('#answer-count'))$('#answer-count').textContent=state.answerCount;
 const q=state.question;if(q&&$('.hint')){const elapsed=state.settings.seconds-left;const n=state.phase==='reveal'?q.hints?.length:elapsed>=20?2:elapsed>=10?1:0;$('.hint').textContent=(q.hints||[]).slice(0,n).join(' · ');}
 if($('#scratch'))paintScratch(left);
 if($('#answer button[type="submit"]'))$('#answer button[type="submit"]').disabled=state.paused||left===0;}
function paintScratch(left){const canvas=$('#scratch'),wrap=$('.photo-wrap');if(!canvas||!wrap)return;const w=wrap.clientWidth,h=wrap.clientHeight;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);if(state.phase==='reveal'){const photo=$('#question-photo');if(photo)photo.style.transform='';return;}const duration=state.settings.seconds;const p=Math.max(0,Math.min(1,(duration-left)/duration));ctx.fillStyle='#c9cfdf';ctx.fillRect(0,0,w,h);ctx.fillStyle='#333d57';ctx.font='700 15px Arial';ctx.textAlign='center';ctx.fillText('RASCA · ADIVINA · REVELA',w/2,h/2);ctx.globalCompositeOperation='destination-out';if(state.question.style==='tiles'){for(let i=0;i<48;i++){if(((i*29)%48)/48<p){ctx.fillRect((i%8)*w/8,Math.floor(i/8)*h/6,w/8+1,h/6+1);}}}else{for(let i=0;i<90*p;i++){const x=((i*71+13)%101)/101*w,y=((i*43+19)%97)/97*h;ctx.beginPath();ctx.arc(x,y,25+p*35,0,Math.PI*2);ctx.fill();}}ctx.globalCompositeOperation='source-over';if(state.question.style==='zoom'&&$('#question-photo'))$('#question-photo').style.transform='scale('+(1+1.2*(1-p))+')';}
setInterval(updateLive,250);
async function createHostedRoom(body){
  if(!config.firebase)config=await request('/api/config',undefined,null);
  try{return await request('/api/rooms',{...body,firebaseToken:await guestIdentity()},null);}
  catch(error){if(error.status!==401)throw error;sessionStorage.removeItem('ronda-firebase');return request('/api/rooms',{...body,firebaseToken:await guestIdentity()},null);}
}
async function guestIdentity(){if(!config.firebase?.apiKey)return null;const saved=JSON.parse(sessionStorage.getItem('ronda-firebase')||'null');if(saved?.expires>Date.now())return saved.token;const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+encodeURIComponent(config.firebase.apiKey),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({returnSecureToken:true})});const data=await r.json();if(!r.ok)throw new Error('Firebase guest sign-in is unavailable. '+(data.error?.message||''));sessionStorage.setItem('ronda-firebase',JSON.stringify({token:data.idToken,expires:Date.now()+3500000}));return data.idToken;}
app.addEventListener('input',e=>{if(e.target.dataset.answerIndex!==undefined){const values=drafts[state.question.id]||[];values[Number(e.target.dataset.answerIndex)]=e.target.value;drafts[state.question.id]=values;}});
app.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;try{if(form.id==='join'){const f=new FormData(form),code=String(f.get('code'));const data=await request('/api/rooms/'+code+'/join',{nickname:f.get('nickname')},null);session={code,playerToken:data.playerToken};persist();await connect();}else if(form.id==='create'){const f=new FormData(form);localStorage.setItem('ronda-chorus-link',String(f.get('chorusUrl')||''));const data=await createHostedRoom({nickname:f.get('nickname'),count:Number(f.get('count')),seconds:Number(f.get('seconds')),auto:f.has('auto'),speedBonus:f.has('speedBonus'),categories:f.getAll('category'),chorusUrl:f.get('chorusUrl')||null});session={code:data.code,hostToken:data.hostToken,playerToken:data.playerToken};persist();await connect();}else if(form.id==='answer'){const q=state.question,values=drafts[q.id]||[];if(!values.some(v=>String(v||'').trim()))throw new Error('Add at least one answer.');accept(await request('/api/rooms/'+session.code+'/answer',{questionId:q.id,values:q.parts.map((_,i)=>values[i]||'')}));}}catch(e){toast(e.message);}finally{if(button)button.disabled=false;}});
app.addEventListener('click',async e=>{const choice=e.target.closest('.choice');if(choice){drafts[state.question.id]=[choice.dataset.value];document.querySelectorAll('.choice').forEach(b=>b.classList.toggle('selected',b===choice));return;}const btn=e.target.closest('[data-action]');if(!btn)return;const action=btn.dataset.action;try{if(action==='winner-history'){showWinnerHistory();}else if(action==='audio-window'){openAudioWindow();syncChorus(state);}else if(action==='home'){stopConnection();home();}else if(action==='setup'){stopConnection();setup();}else if(action==='resume'){await connect();}else if(action==='copy'){await navigator.clipboard.writeText(location.origin+BASE+'/?room='+session.code);toast('Invite link copied.');}else if(action==='export'){const csvCell=value=>'"'+String(value).replace(/^[=+@\-\t\r\n]/,"'$&").replaceAll('"','""')+'"';const rows=[['Rank','Player','Points'],...state.leaderboard.map(p=>[p.rank,p.nickname,p.points])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='la-ronda-'+session.code+'-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}else{if(action==='finish'&&!confirm('End this session and show final scores?'))return;if(action==='start'&&state.hasSongs&&(!audioWindow||audioWindow.closed))openAudioWindow();
const payload={action,expectedPhase:state.phase,expectedIndex:state.index};if(action==='adjust'){payload.playerId=btn.dataset.player;payload.part=Number(btn.dataset.part);payload.correct=btn.dataset.correct==='true';payload.reason=document.querySelector('[data-reason-player="'+btn.dataset.player+'"]').value;}if(action==='void')payload.reason=prompt('Why void this round?','Photo / audio unavailable');if(action==='void'&&payload.reason===null)return;btn.disabled=true;accept(await request('/api/rooms/'+session.code+'/control',payload));}}catch(e){toast(e.message);}finally{btn.disabled=false;}});
let chorus=null,youtubeReady,audioWindow;
function openAudioWindow(){
  if(audioWindow&&!audioWindow.closed){audioWindow.focus();return;}
  stopChorus();youtubeReady=null;
  audioWindow=window.open('', 'la-ronda-private-audio','popup,width=550,height=440');
  if(!audioWindow){toast('Allow popups, then open the private audio window.');return;}
  const doc=audioWindow.document;
  doc.title='La Ronda | Private host audio';
  doc.body.innerHTML='<main><h1>Private host audio</h1><p>Keep this window off the projector. Song clips play here when their questions open.</p></main>';
  doc.body.style.cssText='font:16px system-ui;background:#102d24;color:#f8f2e5;padding:18px';
}
window.addEventListener('pagehide',()=>{if(audioWindow&&!audioWindow.closed)audioWindow.close();});
function stopChorus(){
  const previous=chorus;
  chorus=null;
  previous?.player?.destroy();
  previous?.deck.remove();
}
function loadYouTube(){
  const playerWindow=audioWindow;
  const doc=playerWindow.document;
  if(playerWindow.YT?.Player)return Promise.resolve(playerWindow.YT);
  if(youtubeReady)return youtubeReady;
  youtubeReady=new Promise((resolve,reject)=>{
    const script=doc.createElement('script');
    script.src='https://www.youtube.com/iframe_api';
    const timeout=setTimeout(()=>{script.remove();reject(new Error('Player timed out.'));},12000);
    playerWindow.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve(playerWindow.YT);};
    script.onerror=()=>{clearTimeout(timeout);script.remove();reject(new Error('Player unavailable.'));};
    doc.head.append(script);
  }).catch(error=>{youtubeReady=null;throw error;});
  return youtubeReady;
}
function syncChorus(room){
  if(!audioWindow||audioWindow.closed||!room.isHost||!['countdown','question'].includes(room.phase)||!room.question?.media){stopChorus();return;}
  const key=room.code+':'+room.question.id;
  if(chorus?.key===key){
    const waiting=room.paused||room.phase==='countdown';
    if(chorus.paused!==waiting){
      chorus.paused=waiting;
      if(waiting)chorus.player?.pauseVideo?.();
      else if(!chorus.ended)chorus.player?.playVideo?.();
    }
    return;
  }
  stopChorus();
  const doc=audioWindow.document;
  const deck=doc.createElement('aside');
  deck.innerHTML='<p role="status">Loading the chorus…</p><div class="chorus-embed"></div>';
  doc.body.append(deck);
  const current={key,deck,paused:room.paused||room.phase==='countdown',ended:false,player:null};
  chorus=current;
  const status=message=>{if(chorus===current)deck.querySelector('[role=status]').textContent=message;};
  Promise.all([request('/api/rooms/'+room.code+'/media?question='+encodeURIComponent(room.question.id)),loadYouTube()]).then(([media,YT])=>{
    if(chorus!==current)return;
    if(!media){status('This chorus is unavailable. You can void this question.');return;}
    const clip={videoId:media.videoId,startSeconds:media.start,endSeconds:media.end};
    const frame=doc.createElement('iframe');
    const params=new URLSearchParams({enablejsapi:'1',playsinline:'1',origin:location.origin,start:String(Math.floor(media.start)),end:String(Math.ceil(media.end))});
    frame.src='https://www.youtube.com/embed/'+encodeURIComponent(media.videoId)+'?'+params;
    frame.title='Private chorus player';
    frame.width='480';frame.height='270';
    frame.allow='autoplay; encrypted-media';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.addEventListener('load',()=>{
      if(chorus!==current)return;
      current.player=new YT.Player(frame,{
      events:{
        onReady:({target})=>{
          if(chorus!==current)return;
          if(current.paused)target.cueVideoById(clip);
          else target.loadVideoById(clip);
        },
        onAutoplayBlocked:()=>status('Your browser blocked autoplay. Press play in the player.'),
        onStateChange:({data,target})=>{
          if(chorus!==current)return;
          if(data===YT.PlayerState.PLAYING){
            if(current.paused)target.pauseVideo();
            else status('Playing the chorus');
          }
          if(data===YT.PlayerState.ENDED){current.ended=true;status('Chorus complete');}
        },
        onError:()=>status('This video cannot play here. You can void this question.')
      }
      });
    },{once:true});
    deck.querySelector('.chorus-embed').replaceWith(frame);
  }).catch(()=>status('The chorus could not load. You can void this question.'));
}
$('#sound').onclick=()=>{sound=!sound;$('#sound').textContent=sound?'♫':'♩';toast(sound?'Game sounds on.':'Game sounds off.');if(sound)beep();};
function beep(){if(!sound)return;try{const C=window.AudioContext||window.webkitAudioContext,c=new C(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=620;g.gain.setValueAtTime(.05,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.2);o.start();o.stop(c.currentTime+.2);setTimeout(()=>c.close(),300);}catch{}}
const guideButton=$('#guide-open');
let guide;
function guideSteps(){
  if(view==='setup')return [
    ['#create .panel','Set up the round','Pick your nickname, question count and answer time. Turn speed bonuses off for equal points.'],
    ['#create .checks','Choose the mix','Select the categories you want in this game.'],
    ['#chorus-link','Add songs','Paste a public Chorus Clip playlist link to include song rounds.'],
    ['#create button[type=submit]','Create your room','Create the room, then share its code or invite link.']
  ];
  if(view==='room')return [
    ['.room-code','Room code','Players can join with this code, even after the game starts.'],
    ['[data-action=copy]','Invite players','Copy the link and share it with your group.'],
    ['[data-action=start]','Start the game','Start when your group is ready. For song rounds, keep the private audio window off the shared screen.'],
    ['[data-action=audio-window]','Private audio','Open this once on the host device. Choruses play in that window, away from the game screen.'],
    ['.timer','Watch the timer','Media loads during the countdown. Answer when the question opens.'],
    ['#answer, .receipt, .reveal','Answer and reveal','Pick an option or type an answer. After you submit, the reveal shows what counted.'],
    ['.host-controls:has([data-action=pause])','Host controls','Pause if anyone needs more time. Reveal, advance, or void a question when needed.'],
    ['.board','Leaderboard','Scores update after the reveal. First place gets a crown.'],
    ['[data-action=export]','Save scores','Download the finished leaderboard as a spreadsheet-friendly CSV.']
  ];
  return [
    ['#join input[name=nickname]','Pick a nickname','Use a name that nobody else in this room has taken.'],
    ['#join input[name=code]','Enter the room code','Use the six digits from the host, then press Join.'],
    ['[data-action=setup]','Hosting?','Open host setup to choose the mix, time limit and optional song playlist.']
  ];
}
function closeGuide(){
  if(!guide)return;
  guide.panel.remove();guide.marker.remove();guide=null;
  guideButton.focus({preventScroll:true});
}
function positionGuide(){
  if(!guide)return;
  const target=$(guide.steps[guide.index][0]);
  if(!target){closeGuide();return;}
  const rect=target.getBoundingClientRect(),{panel,marker}=guide;
  Object.assign(marker.style,{left:rect.left-3+'px',top:rect.top-3+'px',width:rect.width+6+'px',height:rect.height+6+'px'});
  marker.hidden=rect.bottom<0||rect.top>innerHeight;
  const below=rect.bottom+14+panel.offsetHeight<=innerHeight;
  const above=rect.top-14-panel.offsetHeight>=0;
  const top=below?rect.bottom+14:above?rect.top-14-panel.offsetHeight:innerHeight-panel.offsetHeight-10;
  const left=Math.max(10,Math.min(rect.left,innerWidth-panel.offsetWidth-10));
  panel.style.left=left+'px';
  panel.style.top=Math.max(10,top)+'px';
  panel.style.setProperty('--guide-arrow',Math.max(12,Math.min(rect.left+rect.width/2-left,panel.offsetWidth-22))+'px');
  panel.dataset.side=below?'below':above?'above':'edge';
}
function showGuideStep(index){
  guide.index=index;
  const [selector,title,message]=guide.steps[index];
  $(selector)?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  guide.panel.innerHTML=`<div class="guide-top"><span>${index+1} / ${guide.steps.length}</span><button type="button" data-guide="close" aria-label="Close tutorial">×</button></div><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="guide-actions"><button class="btn secondary small" type="button" data-guide="back" ${index===0?'disabled':''}>Back</button><button class="btn small" type="button" data-guide="next">${index+1===guide.steps.length?'Done':'Next'}</button></div>`;
  positionGuide();
  guide.panel.querySelector('[data-guide=next]').focus({preventScroll:true});
}
guideButton.addEventListener('click',()=>{
  if(guide){closeGuide();return;}
  const steps=guideSteps().filter(([selector])=>$(selector));
  if(!steps.length)return;
  const panel=document.createElement('aside'),marker=document.createElement('div');
  panel.className='guide-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','How to play La Ronda');
  marker.className='guide-marker';marker.setAttribute('aria-hidden','true');
  document.body.append(marker,panel);guide={panel,marker,steps,index:0};
  panel.addEventListener('click',event=>{
    const action=event.target.closest('[data-guide]')?.dataset.guide;
    if(action==='close'||(action==='next'&&guide.index+1===steps.length))closeGuide();
    else if(action==='next'||action==='back')showGuideStep(guide.index+(action==='next'?1:-1));
  });
  showGuideStep(0);
});
window.addEventListener('scroll',positionGuide,{passive:true});
window.addEventListener('resize',positionGuide);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&guide)closeGuide();});
new MutationObserver(positionGuide).observe(app,{childList:true});
try{session=JSON.parse(localStorage.getItem('ronda-session')||'null');}catch{localStorage.removeItem('ronda-session');}
try{config=await request('/api/config',undefined,null);}catch(e){toast('Server unavailable. Start the app server to create or join a room.');}
home();

let liveConnection;function liveSocket(){liveConnection?.close();const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+BASE+'/live');liveConnection=ws;ws.onopen=()=>ws.send(JSON.stringify({code:session.code,token:session.hostToken||session.playerToken}));ws.onmessage=e=>{if(liveConnection!==ws)return;try{accept(JSON.parse(e.data));}catch{ws.close();}};ws.onerror=()=>ws.close();ws.onclose=()=>{if(liveConnection===ws&&view==='room'&&state?.phase!=='finished')poll();};}
