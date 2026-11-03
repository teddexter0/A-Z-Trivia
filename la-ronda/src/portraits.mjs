import {normalize} from './engine.mjs';

export function makePortraitLookup(env){
  let token,expiresAt=0;
  const request=async(url,options={})=>{
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw new Error('Portrait provider unavailable.');
    return response.json();
  };
  return async ({wiki:name,portrait:provider})=>{
    try{
      if(provider==='spotify'&&env.RONDA_SPOTIFY_CLIENT_ID&&env.RONDA_SPOTIFY_CLIENT_SECRET){
        if(!token||Date.now()>=expiresAt){
          const credentials=Buffer.from(env.RONDA_SPOTIFY_CLIENT_ID+':'+env.RONDA_SPOTIFY_CLIENT_SECRET).toString('base64');
          const auth=await request('https://accounts.spotify.com/api/token',{method:'POST',headers:{authorization:'Basic '+credentials,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
          token=auth.access_token;
          expiresAt=Date.now()+(auth.expires_in-60)*1000;
        }
        const result=await request('https://api.spotify.com/v1/search?type=artist&limit=5&q='+encodeURIComponent('artist:'+name),{headers:{authorization:'Bearer '+token}});
        const artist=result.artists?.items?.find(person=>normalize(person.name)===normalize(name)&&person.images?.length);
        const image=artist?.images.find(item=>/^https:\/\/i\.scdn\.co\/image\/[a-z0-9]+$/i.test(item.url));
        if(image&&/^[A-Za-z0-9]{22}$/.test(artist.id))return {image:image.url,provider:'Spotify',link:'https://open.spotify.com/artist/'+artist.id};
      }
      if(provider==='tmdb'&&env.RONDA_TMDB_READ_TOKEN){
        const result=await request('https://api.themoviedb.org/3/search/person?include_adult=false&query='+encodeURIComponent(name),{headers:{authorization:'Bearer '+env.RONDA_TMDB_READ_TOKEN}});
        const actor=result.results?.find(person=>normalize(person.name)===normalize(name)&&person.known_for_department==='Acting'&&/^\/[A-Za-z0-9]+\.jpg$/.test(person.profile_path));
        if(actor&&Number.isInteger(actor.id))return {image:'https://image.tmdb.org/t/p/w500'+actor.profile_path,provider:'TMDB',link:'https://www.themoviedb.org/person/'+actor.id};
      }
    }catch{ /* The regular question photo remains available. */ }
    return null;
  };
}
