import {createSign} from 'node:crypto';
// Server-only credential. Never import this module into the browser bundle.
export class FirebaseStore {
  constructor(account,fetcher=fetch){
    this.account=typeof account==='string'?JSON.parse(account):account;
    if(this.account.project_id!=='la-ronda-spanish-trivia'||!this.account.client_email||!this.account.private_key)throw new Error('Use a server credential for the dedicated La Ronda Firebase project.');
    this.fetcher=fetcher;this.base='https://firestore.googleapis.com/v1/projects/'+this.account.project_id+'/databases/(default)/documents';
  }
  async accessToken(){
    if(this.token&&this.tokenExpires>Date.now()+60000)return this.token;
    const now=Math.floor(Date.now()/1000),encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
    const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:this.account.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    const signer=createSign('RSA-SHA256');signer.update(unsigned);const assertion=unsigned+'.'+signer.sign(this.account.private_key,'base64url');
    const r=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error('Firebase server authentication failed.');const data=await r.json();this.token=data.access_token;this.tokenExpires=Date.now()+Number(data.expires_in)*1000;return this.token;
  }
  async request(path,options={}){return this.fetcher(this.base+path,{...options,headers:{'content-type':'application/json',authorization:'Bearer '+await this.accessToken(),...options.headers},signal:AbortSignal.timeout(15000)});}
  fields(room){return {value:{stringValue:JSON.stringify(room)},expiresAt:{timestampValue:new Date(room.expiresAt).toISOString()}};}
  async get(code){const r=await this.request('/rooms/'+code);if(r.status===404)return null;if(!r.ok)throw new Error('Firebase room read failed.');const doc=await r.json();return {room:JSON.parse(doc.fields.value.stringValue),revision:doc.updateTime};}
  async insert(room){const r=await this.request('/rooms?documentId='+encodeURIComponent(room.code),{method:'POST',body:JSON.stringify({fields:this.fields(room)})});if(!r.ok)throw new Error(r.status===409?'Code collision.':'Firebase room creation failed.');}
  async cas(code,room,revision){const r=await this.request('/rooms/'+code+'?currentDocument.updateTime='+encodeURIComponent(revision),{method:'PATCH',body:JSON.stringify({fields:this.fields(room)})});if(r.status===409||r.status===412||r.status===404)return false;if(!r.ok)throw new Error('Firebase room update failed.');return true;}
  async history(){const r=await this.request(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'history'}],orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],limit:6}})});if(!r.ok)throw new Error('Firebase history read failed.');const rows=await r.json();return rows.filter(x=>x.document).reverse().map(x=>({entities:JSON.parse(x.document.fields.entities.stringValue)}));}
  async record(room){const r=await this.request('/history?documentId='+encodeURIComponent(room.code),{method:'POST',body:JSON.stringify({fields:{createdAt:{timestampValue:new Date(room.createdAt).toISOString()},entities:{stringValue:JSON.stringify(room.questions.map(q=>q.entity))}}})});if(!r.ok&&r.status!==409)throw new Error('Firebase history write failed.');}
}
