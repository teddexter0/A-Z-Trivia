import WebSocket from '../vendor/ws/index.js';
const WebSocketServer=WebSocket.Server;

export function attachRealtime(server,api,{socketPath='/live'}={}){
  const wss=new WebSocketServer({noServer:true,maxPayload:4096});
  server.on('upgrade',(req,socket,head)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname!==socketPath)return;
    let origin;try{origin=new URL(req.headers.origin);}catch{socket.destroy();return;}
    if(origin.host!==req.headers.host){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    let interval,busy=false,authenticated=false;
    const timeout=setTimeout(()=>ws.close(1008,'Authentication required'),8000);
    ws.once('message',async raw=>{
      try{
        const {code,token}=JSON.parse(raw.toString());
        if(!/^\d{6}$/.test(code)||typeof token!=='string'||token.length>200)throw Error('Invalid session');
        const request=()=>new Request('https://ronda.internal/api/rooms/'+code+'/state',{headers:{authorization:'Bearer '+token}});
        const initial=await api(request());if(!initial.ok)throw Error('Session unavailable');
        authenticated=true;clearTimeout(timeout);ws.send(await initial.text());
        interval=setInterval(async()=>{if(busy||ws.readyState!==1)return;busy=true;try{const r=await api(request());if(!r.ok){ws.close(1008,'Session expired');return;}ws.send(await r.text());}catch{ws.close(1011,'Reconnect required');}finally{busy=false;}},500);
      }catch{ws.close(1008,'Invalid session');}
    });
    ws.on('close',()=>{clearTimeout(timeout);clearInterval(interval);});
    ws.on('error',()=>{clearTimeout(timeout);clearInterval(interval);});
  });
  return wss;
}
