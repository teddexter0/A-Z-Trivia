import {readFile} from 'node:fs/promises';
import {makeApi} from './src/api.mjs';
import {FirebaseStore} from './src/firebase-store.mjs';
import {attachRealtime} from './src/realtime.mjs';
const root=new URL('./',import.meta.url);
export async function mountRonda(server,{prefix='/la-ronda'}={}){
  const credential=process.env.RONDA_FIREBASE_SERVICE_ACCOUNT;
  if(!credential)throw new Error('La Ronda needs its dedicated Firebase server credential.');
  const catalog=JSON.parse(await readFile(new URL('src/catalog.json',root),'utf8'));
  const config=JSON.parse(await readFile(new URL('src/config.json',root),'utf8'));config.transport='websocket';
  const api=makeApi({store:new FirebaseStore(credential),catalog,config,local:false});
  const assets=new Map(await Promise.all([['/','web/index.html','text/html'],['/app.js','web/app.js','text/javascript'],['/style.css','web/style.css','text/css']].map(async([p,file,type])=>[p,{text:await readFile(new URL(file,root),'utf8'),type}])));
  attachRealtime(server,api,{socketPath:prefix+'/live'});
  return async(req,res)=>{
    try{
      const pathname=req.url.split('?')[0];
      if(pathname===prefix){res.writeHead(302,{location:prefix+'/'});res.end();return;}
      const local=req.url.slice(prefix.length)||'/';
      if(local.split('?')[0]==='/healthz'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}
      if(local.startsWith('/api/')){
        const protocol=req.headers['x-forwarded-proto']==='https'?'https':'http';
        const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>200000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        const body=Buffer.concat(chunks);const headers=new Headers();for(const [k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
        const response=await api(new Request(protocol+'://'+req.headers.host+local,{method:req.method,headers,...(body.length?{body}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      const asset=assets.get(local.split('?')[0]);if(!asset){res.writeHead(404);res.end('Not found');return;}
      const text=asset.type==='text/html'?asset.text.replaceAll('href="/"','href="'+prefix+'/"').replaceAll('href="/style.css"','href="'+prefix+'/style.css"').replaceAll('src="/app.js"','src="'+prefix+'/app.js"'):asset.text;
      res.writeHead(200,{'content-type':asset.type+'; charset=utf-8','x-content-type-options':'nosniff'});res.end(text);
    }catch{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'La Ronda is temporarily unavailable. Please reconnect.'}));}
  };
}
