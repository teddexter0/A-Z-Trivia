import {normalize} from './engine.mjs';

export function makePortraitLookup(env){
  const request=async(url,options={})=>{
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw new Error('Portrait provider unavailable.');
    return response.json();
  };
  return async ({wiki:name,portrait:provider})=>{
    try{
      if(provider==='tmdb'&&env.RONDA_TMDB_READ_TOKEN){
        const result=await request('https://api.themoviedb.org/3/search/person?include_adult=false&query='+encodeURIComponent(name),{headers:{authorization:'Bearer '+env.RONDA_TMDB_READ_TOKEN}});
        const actor=result.results?.find(person=>normalize(person.name)===normalize(name)&&person.known_for_department==='Acting'&&/^\/[A-Za-z0-9]+\.jpg$/.test(person.profile_path));
        if(actor&&Number.isInteger(actor.id))return {image:'https://image.tmdb.org/t/p/w500'+actor.profile_path,provider:'TMDB',link:'https://www.themoviedb.org/person/'+actor.id};
      }
    }catch{ /* The regular question photo remains available. */ }
    return null;
  };
}
