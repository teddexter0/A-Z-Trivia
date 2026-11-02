export class D1Store {
  constructor(db){this.db=db;}
  async get(code){const row=await this.db.prepare('SELECT value, revision FROM rooms WHERE code = ?').bind(code).first();return row?{room:JSON.parse(row.value),revision:row.revision}:null;}
  async insert(room){await this.db.prepare('INSERT INTO rooms (code,value,revision,expires_at) VALUES (?,?,0,?)').bind(room.code,JSON.stringify(room),room.expiresAt).run();}
  async cas(code,room,revision){const r=await this.db.prepare('UPDATE rooms SET value = ?, revision = revision + 1 WHERE code = ? AND revision = ?').bind(JSON.stringify(room),code,revision).run();return r.meta.changes===1;}
  async history(){const {results}=await this.db.prepare('SELECT entities FROM history ORDER BY created_at DESC LIMIT 6').all();return results.reverse().map(r=>({entities:JSON.parse(r.entities)}));}
  async record(room){await this.db.prepare('INSERT OR IGNORE INTO history (id,created_at,entities) VALUES (?,?,?)').bind(room.code,room.createdAt,JSON.stringify(room.questions.map(q=>q.entity))).run();}
}
export class MemoryStore {
  constructor(){this.rooms=new Map();this.past=[];}
  async get(code){return this.rooms.has(code)?structuredClone(this.rooms.get(code)):null;}
  async insert(room){if(this.rooms.has(room.code))throw new Error('Code collision.');this.rooms.set(room.code,{room:structuredClone(room),revision:0});}
  async cas(code,room,revision){const row=this.rooms.get(code);if(!row||row.revision!==revision)return false;this.rooms.set(code,{room:structuredClone(room),revision:revision+1});return true;}
  async history(){return structuredClone(this.past);}
  async record(room){if(!this.past.some(h=>h.id===room.code))this.past.push({id:room.code,entities:room.questions.map(q=>q.entity)});}
}
