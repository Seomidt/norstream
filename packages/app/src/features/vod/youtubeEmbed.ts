/** App-id'et som baseUrl giver YouTube den identitet WebView ellers mangler. */
export const YOUTUBE_EMBED_ORIGIN = 'https://dk.seomidt.norstream';
export const YOUTUBE_START_TIMEOUT_MS = 20_000;
export const YOUTUBE_STALL_TIMEOUT_MS = 15_000;
export const YOUTUBE_MAX_RELOADS = 2;

/** Android giver ikke altid isTopFrame for en iframe-navigation. */
export function youtubeEmbedNavigationAllowed(url: string): boolean {
  if (url === 'about:blank' || url === YOUTUBE_EMBED_ORIGIN || url === `${YOUTUBE_EMBED_ORIGIN}/`) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ['www.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname) &&
      !u.username && !u.password && !u.port && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(u.pathname);
  } catch { return false; }
}

export type TrailerCommand = 'toggle' | 'play' | 'pause' | 'backward' | 'forward';

/** Et fast saet kommandoer: aldrig fri tekst ind i injectJavaScript. */
export function trailerCommandScript(command: TrailerCommand): string {
  return `window.NorStreamTrailer && window.NorStreamTrailer.command(${JSON.stringify(command)}); true;`;
}

/**
 * YouTubes officielle IFrame-afspiller styrer hentning, codecs og kvalitet.
 * Ingen pause/spol ved opstart, ingen private videoadresser eller udgaaede
 * setPlaybackQuality-kald. En besked hvert sekund lader appen opdage frost
 * selv naar afspilleren fortsat paastaar at den spiller.
 */
export function youtubeEmbedPage(videoId: string, wide: boolean, startAt = 0, attempt = 0): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Ugyldigt YouTube-id');
  const start = Number.isFinite(startAt) ? Math.max(0, Math.floor(startAt)) : 0;
  return `<!doctype html><html><head>
<meta name="viewport" content="${wide ? 'width=1920' : 'width=device-width, initial-scale=1'}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}#player{position:absolute;inset:0;width:100%;height:100%;border:0}</style>
</head><body><div id="player"></div><script>
var player=null,ended=false,disposed=false;
function post(m){if(!disposed&&window.ReactNativeWebView){m.attempt=${Math.max(0, Math.floor(attempt))};window.ReactNativeWebView.postMessage(JSON.stringify(m));}}
function report(){
  if(!player||disposed)return;
  try{post({type:'status',state:player.getPlayerState(),position:player.getCurrentTime(),seconds:player.getDuration(),loaded:player.getVideoLoadedFraction()});}catch(e){}
}
window.NorStreamTrailer={command:function(command){
  if(!player||disposed)return;
  try{
    if(command==='pause'){player.pauseVideo();}
    else if(command==='play'){player.playVideo();}
    else if(command==='toggle'){if(player.getPlayerState()===1){player.pauseVideo();}else{player.playVideo();}}
    else if(command==='backward'||command==='forward'){
      var t=player.getCurrentTime()+(command==='forward'?10:-10);
      player.seekTo(Math.max(0,Math.min(t,Math.max(0,player.getDuration()-1))),true);
    }
  }catch(e){}
}};
window.onYouTubeIframeAPIReady=function(){
  if(disposed)return;
  player=new YT.Player('player',{videoId:'${videoId}',playerVars:{autoplay:1,playsinline:1,rel:0,controls:1,fs:0,start:${start},origin:'${YOUTUBE_EMBED_ORIGIN}',widget_referrer:'${YOUTUBE_EMBED_ORIGIN}'},events:{
    onReady:function(e){post({type:'ready'});e.target.playVideo();report();},
    onStateChange:function(e){report();if(e.data===0&&!ended){ended=true;post({type:'ended'});}},
    onError:function(e){post({type:'error',code:e.data});},
    onAutoplayBlocked:function(){post({type:'autoplay-blocked'});},
    onPlaybackQualityChange:function(e){post({type:'quality',quality:e.data});}
  }});
};
var heartbeat=setInterval(report,1000);
var apiTimer=setTimeout(function(){if(!player){post({type:'noapi'});}},12000);
window.addEventListener('pagehide',function(){disposed=true;clearInterval(heartbeat);clearTimeout(apiTimer);if(player){player.destroy();}});
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;
}

export interface YoutubeStatus {
  state: number;
  position: number;
  seconds: number;
}

/**
 * Vagtens tid er fremdrift, ikke readyToPlay. Pause fra brugeren er aldrig
 * frost. En slutning foer tid sendes videre til den begraensede genopretning.
 */
export class YoutubePlaybackWatch {
  private lastProgressAt: number;
  private started = false;
  private paused = false;
  private ended = false;
  position: number;
  seconds = 0;

  constructor(private readonly openedAt: number, startAt = 0) {
    this.lastProgressAt = openedAt;
    this.position = startAt;
  }

  update(status: YoutubeStatus, now: number): void {
    if (Number.isFinite(status.seconds) && status.seconds > 0) this.seconds = status.seconds;
    this.paused = status.state === 2;
    this.ended = status.state === 0;
    if (this.paused) this.lastProgressAt = now;
    if (status.state === 1) {
      if (!this.started || Math.abs(status.position - this.position) >= 0.25) {
        this.lastProgressAt = now;
      }
      this.started = true;
    }
    if (Number.isFinite(status.position) && status.position >= 0) this.position = status.position;
  }

  problem(now: number): 'start-timeout' | 'stall' | 'early-end' | null {
    if (this.ended) return this.seconds > 0 && this.position < this.seconds - 3 ? 'early-end' : null;
    if (this.paused) return null;
    if (!this.started) return now - this.openedAt >= YOUTUBE_START_TIMEOUT_MS ? 'start-timeout' : null;
    return now - this.lastProgressAt >= YOUTUBE_STALL_TIMEOUT_MS ? 'stall' : null;
  }
}
