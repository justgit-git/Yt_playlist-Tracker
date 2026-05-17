import React, { useState, useCallback } from "react";

const YT_API_KEY = "AIzaSyClPjT408pwK4Qdy7qIUwKBKnHaXKMAB74";
const STORAGE_KEY = "yt_tracker_v5";

function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { playlists: {} }; }
  catch { return { playlists: {} }; }
}
function saveData(d) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {} }

function extractPlaylistId(input) {
  try { return new URL(input.trim()).searchParams.get("list"); }
  catch { const m = input.match(/[?&]list=([A-Za-z0-9_-]+)/); return m ? m[1] : null; }
}

function isoToSec(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0);
}

function fmtSec(sec) {
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=Math.floor(sec%60);
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDur(sec) {
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=Math.floor(sec%60);
  if(h>0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

async function fetchAllVideos(playlistId, onProgress) {
  let videos=[], pageToken="";
  do {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YT_API_KEY}${pageToken?`&pageToken=${pageToken}`:""}`);
    const d = await r.json();
    if(d.error) throw new Error(d.error.message);
    const ids = d.items.map(i=>i.snippet.resourceId.videoId).join(",");
    const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YT_API_KEY}`);
    const vd = await vr.json();
    const dm = {};
    (vd.items||[]).forEach(v=>{ dm[v.id]=isoToSec(v.contentDetails.duration); });
    d.items.forEach(item=>{
      const vid=item.snippet.resourceId.videoId;
      if(item.snippet.title==="Deleted video"||item.snippet.title==="Private video") return;
      const sec=dm[vid]||0;
      videos.push({ id:vid, title:item.snippet.title, thumbnail:item.snippet.thumbnails?.medium?.url||item.snippet.thumbnails?.default?.url||"", position:videos.length+1, durationSec:sec, duration:fmtDur(sec) });
    });
    if(onProgress) onProgress(videos.length);
    pageToken=d.nextPageToken||"";
  } while(pageToken);
  return videos;
}

async function fetchMeta(playlistId) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${YT_API_KEY}`);
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  if(!d.items?.length) throw new Error("Playlist not found or is private");
  const s=d.items[0].snippet;
  return { title:s.title, author:s.channelTitle, thumbnail:s.thumbnails?.medium?.url||s.thumbnails?.default?.url||"" };
}

function buildDayPlan(videos, dailyWallClockSec, speed) {
  const contentPerDay = dailyWallClockSec * speed;
  const days = [];
  let current = [], currentSec = 0;
  for (const v of videos) {
    const vSec = v.durationSec || 60;
    if (current.length > 0 && currentSec + vSec > contentPerDay * 1.05) {
      days.push(current);
      current = [v];
      currentSec = vSec;
    } else {
      current.push(v);
      currentSec += vSec;
    }
  }
  if (current.length > 0) days.push(current);
  return days;
}

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
const HOURS_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 4];
const MINS_OPTIONS = [0, 15, 30, 45];

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');

*{box-sizing:border-box;margin:0;padding:0}

body,#root{
  font-family:'Plus Jakarta Sans',sans-serif;
  background:#05050f;
  color:#eae6db;
  min-height:100vh;
  background-image: radial-gradient(ellipse at 20% 20%, rgba(255,45,45,0.07) 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 80%, rgba(100,40,255,0.05) 0%, transparent 50%);
}

.app{max-width:960px;margin:0 auto;padding:2.5rem 1.5rem 6rem}

/* HEADER */
.header{margin-bottom:3rem;text-align:center;padding-top:1rem}
.logo-wrap{display:inline-flex;align-items:center;justify-content:center;gap:14px;margin-bottom:1rem}
.logo{
  width:48px;height:48px;
  background:linear-gradient(135deg,#ff2d2d,#ff6b35);
  border-radius:14px;
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 8px 24px rgba(255,45,45,0.35);
  transition:transform .3s ease, box-shadow .3s ease;
}
.logo:hover{transform:scale(1.08) rotate(-3deg);box-shadow:0 12px 32px rgba(255,45,45,0.5)}
.logo svg{width:22px;height:22px;fill:white}
.brand{font-size:32px;font-weight:800;letter-spacing:-1px;color:#fff;line-height:1}
.brand span{color:#ff2d2d}
.tagline{font-size:15px;color:#555258;font-family:'Space Mono',monospace;letter-spacing:0.5px}

/* ADD SECTION */
.add-section{margin-bottom:2.5rem}
.input-wrap{
  display:flex;gap:12px;
  background:rgba(255,255,255,0.03);
  border:1px solid rgba(255,255,255,0.08);
  border-radius:16px;
  padding:10px 10px 10px 20px;
  transition:border-color .3s ease, box-shadow .3s ease;
}
.input-wrap:focus-within{
  border-color:rgba(255,45,45,0.5);
  box-shadow:0 0 0 4px rgba(255,45,45,0.08);
}
.url-input{
  flex:1;background:transparent;border:none;
  color:#eae6db;font-size:15px;
  font-family:'Space Mono',monospace;
  outline:none;
}
.url-input::placeholder{color:#333340;font-size:14px}
.add-btn{
  background:linear-gradient(135deg,#ff2d2d,#ff5533);
  color:white;border:none;border-radius:10px;
  padding:13px 24px;font-size:15px;font-weight:700;
  cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;
  transition:all .25s ease;white-space:nowrap;
  display:flex;align-items:center;gap:8px;
  box-shadow:0 4px 16px rgba(255,45,45,0.3);
}
.add-btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(255,45,45,0.4)}
.add-btn:active{transform:translateY(0px)}
.add-btn:disabled{background:#2a1a1a;color:#5a3030;cursor:not-allowed;box-shadow:none;transform:none}
.err{font-size:13px;color:#ff7070;margin-top:10px;font-family:'Space Mono',monospace;padding-left:4px}

/* STATS BAR */
.stats-bar{display:flex;gap:12px;margin-bottom:2rem;flex-wrap:wrap}
.stat-pill{
  background:rgba(255,255,255,0.03);
  border:1px solid rgba(255,255,255,0.07);
  border-radius:10px;padding:10px 16px;
  font-family:'Space Mono',monospace;font-size:13px;color:#666260;
  transition:border-color .2s;
}
.stat-pill:hover{border-color:rgba(255,45,45,0.3)}
.stat-pill span{color:#eae6db;font-weight:700}

/* EMPTY STATE */
.empty{text-align:center;padding:5rem 2rem}
.empty-icon{font-size:56px;margin-bottom:1.5rem;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.empty-title{font-size:22px;font-weight:700;color:#666260;margin-bottom:8px}
.empty-sub{font-size:14px;color:#333330;font-family:'Space Mono',monospace}

/* CARDS */
.cards{display:flex;flex-direction:column;gap:1.75rem}
.card{
  background:linear-gradient(145deg,#0d0d1a,#0a0a14);
  border:1px solid rgba(255,255,255,0.07);
  border-radius:20px;overflow:hidden;
  transition:border-color .3s ease, transform .3s ease, box-shadow .3s ease;
  animation:slideUp .4s ease forwards;
}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.card:hover{border-color:rgba(255,45,45,0.2);box-shadow:0 8px 40px rgba(0,0,0,0.4)}

.pbar-track{height:3px;background:rgba(255,255,255,0.05)}
.pbar-fill{height:100%;background:linear-gradient(90deg,#ff2d2d,#ff6b35);transition:width .6s cubic-bezier(.4,0,.2,1)}

/* CARD HEADER */
.card-header{
  padding:1.5rem 1.75rem;
  display:flex;align-items:center;gap:16px;
  cursor:pointer;user-select:none;
  transition:background .2s ease;
}
.card-header:hover{background:rgba(255,255,255,0.02)}
.thumb{
  width:72px;height:54px;border-radius:10px;
  object-fit:cover;background:#1a1a26;flex-shrink:0;
  box-shadow:0 4px 12px rgba(0,0,0,0.4);
  transition:transform .3s ease;
}
.card-header:hover .thumb{transform:scale(1.03)}
.thumb-ph{
  width:72px;height:54px;border-radius:10px;
  background:linear-gradient(135deg,#1a1a26,#0f0f1a);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.meta{flex:1;min-width:0}
.pl-title{
  font-size:18px;font-weight:700;color:#fff;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  margin-bottom:5px;letter-spacing:-0.3px;
}
.pl-author{font-size:13px;color:#555258;font-family:'Space Mono',monospace}
.right-side{display:flex;align-items:center;gap:12px;flex-shrink:0}
.pct-block{text-align:right}
.pct-num{font-size:20px;font-weight:800;color:#ff2d2d;display:block;line-height:1;letter-spacing:-0.5px}
.pct-sub{font-size:12px;color:#555258;font-family:'Space Mono',monospace;margin-top:2px}
.chevron{
  color:#333340;font-size:18px;
  transition:transform .3s cubic-bezier(.4,0,.2,1), color .2s;
  flex-shrink:0;
}
.chevron.open{transform:rotate(180deg);color:#ff2d2d}
.del-btn{
  background:none;border:none;color:#333340;cursor:pointer;
  padding:7px;border-radius:8px;
  transition:color .2s,background .2s,transform .2s;
  display:flex;align-items:center;flex-shrink:0;
}
.del-btn:hover{color:#ff7070;background:rgba(255,45,45,0.1);transform:scale(1.1)}

/* TABS */
.tab-bar{
  display:flex;gap:4px;padding:14px 1.75rem 0;
  border-bottom:1px solid rgba(255,255,255,0.06);
}
.tab-btn{
  background:none;border:none;
  color:#555258;font-size:14px;font-weight:600;
  cursor:pointer;padding:10px 16px;
  border-radius:10px 10px 0 0;
  transition:all .25s ease;
  border-bottom:2px solid transparent;
  margin-bottom:-1px;
  font-family:'Plus Jakarta Sans',sans-serif;
}
.tab-btn:hover{color:#aaa49a;background:rgba(255,255,255,0.03)}
.tab-btn.active{color:#ff2d2d;border-bottom-color:#ff2d2d;background:rgba(255,45,45,0.05)}

/* INFO PANEL */
.info-panel{margin:1.25rem 1.75rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden}
.total-dur-box{padding:1.25rem;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)}
.total-dur-label{font-size:11px;letter-spacing:2px;color:#555258;font-family:'Space Mono',monospace;text-transform:uppercase;margin-bottom:6px}
.total-dur-val{font-size:28px;font-weight:800;color:#fff;letter-spacing:-1px}
.speed-section{padding:1.25rem}
.section-label{font-size:11px;letter-spacing:2px;color:#555258;font-family:'Space Mono',monospace;text-transform:uppercase;margin-bottom:12px}
.speed-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.speed-card{
  background:rgba(255,255,255,0.03);
  border:1px solid rgba(255,255,255,0.07);
  border-radius:10px;padding:10px 6px;text-align:center;
  cursor:pointer;
  transition:all .25s ease;
}
.speed-card:hover{border-color:rgba(255,45,45,0.4);background:rgba(255,45,45,0.05);transform:translateY(-2px)}
.speed-card.active{border-color:#ff2d2d;background:rgba(255,45,45,0.1);transform:translateY(-2px);box-shadow:0 4px 16px rgba(255,45,45,0.2)}
.speed-lbl{font-size:11px;color:#555258;font-family:'Space Mono',monospace;margin-bottom:4px}
.speed-time{font-size:13px;font-weight:700;color:#eae6db}
.speed-card.active .speed-time{color:#ff2d2d}

/* DAY PLAN */
.plan-panel{margin:0 1.75rem 1.25rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden}
.plan-controls{
  padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.06);
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
}
.plan-controls-label{font-size:15px;color:#888480;font-weight:600}
.plan-select{
  background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.1);
  color:#eae6db;border-radius:9px;
  padding:9px 12px;font-size:14px;
  font-family:'Space Mono',monospace;
  outline:none;cursor:pointer;
  transition:all .25s ease;
}
.plan-select:focus{border-color:rgba(255,45,45,0.5);background:rgba(255,45,45,0.05)}

.plan-summary{
  padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.06);
  display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;
}
.plan-sum-item{text-align:center;padding:0.5rem}
.plan-sum-val{font-size:26px;font-weight:800;color:#ff2d2d;display:block;line-height:1;letter-spacing:-1px;margin-bottom:6px}
.plan-sum-lbl{font-size:11px;color:#555258;font-family:'Space Mono',monospace;text-transform:uppercase;letter-spacing:1px}

/* DAY ROWS */
.day-row{border-bottom:1px solid rgba(255,255,255,0.04);transition:background .2s ease}
.day-row:last-child{border-bottom:none}
.day-row:hover{background:rgba(255,255,255,0.02)}
.day-row-header{padding:1rem 1.25rem;display:flex;align-items:center;gap:14px;cursor:pointer}
.day-badge{
  background:rgba(255,45,45,0.1);
  border:1px solid rgba(255,45,45,0.25);
  color:#ff2d2d;font-size:13px;font-weight:700;
  font-family:'Space Mono',monospace;
  padding:5px 12px;border-radius:20px;flex-shrink:0;
  transition:all .25s ease;
}
.day-badge.done{background:rgba(74,222,128,0.1);border-color:rgba(74,222,128,0.3);color:#4ade80}
.day-info{flex:1;min-width:0}
.day-title{font-size:15px;font-weight:700;color:#c8c4b8;margin-bottom:3px}
.day-sub{font-size:12px;color:#444440;font-family:'Space Mono',monospace}
.day-pbar-wrap{width:100px;flex-shrink:0}
.day-pbar-track{height:5px;background:rgba(255,255,255,0.06);border-radius:3px}
.day-pbar-fill{height:100%;background:linear-gradient(90deg,#ff2d2d,#ff6b35);border-radius:3px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.day-pbar-fill.done{background:linear-gradient(90deg,#4ade80,#22c55e)}
.day-chevron{color:#2a2a3a;font-size:14px;transition:transform .3s cubic-bezier(.4,0,.2,1);flex-shrink:0}
.day-chevron.open{transform:rotate(180deg);color:#ff2d2d}

/* VIDEOS */
.day-videos{background:rgba(0,0,0,0.2);border-top:1px solid rgba(255,255,255,0.04)}
.all-videos-wrap{padding:4px 0}
.search-bar{
  padding:10px 1.75rem 6px;
  display:flex;align-items:center;gap:10px;
  border-bottom:1px solid rgba(255,255,255,0.05);
}
.search-input{
  flex:1;background:transparent;border:none;outline:none;
  font-size:14px;color:#aaa49a;
  font-family:'Space Mono',monospace;padding:4px 0;
}
.search-input::placeholder{color:#333340}
.video-count-badge{font-size:12px;font-family:'Space Mono',monospace;color:#444440;padding:8px 1.75rem}
.vrow{
  display:flex;align-items:center;gap:12px;
  padding:11px 1.75rem;
  transition:background .2s ease;
  cursor:pointer;
  border-bottom:1px solid rgba(255,255,255,0.03);
}
.vrow:last-child{border-bottom:none}
.vrow:hover{background:rgba(255,255,255,0.03)}
.vrow.done .vtitle{color:#3a3835;text-decoration:line-through;text-decoration-color:#2a2825}
.vthumb{width:52px;height:38px;border-radius:7px;object-fit:cover;background:#1a1a26;flex-shrink:0;transition:transform .2s}
.vrow:hover .vthumb{transform:scale(1.04)}
.vthumb-ph{width:52px;height:38px;border-radius:7px;background:#1a1a26;flex-shrink:0}
.check{
  width:22px;height:22px;border-radius:50%;
  border:2px solid rgba(255,255,255,0.12);
  flex-shrink:0;display:flex;align-items:center;justify-content:center;
  transition:all .25s cubic-bezier(.4,0,.2,1);background:transparent;
}
.check:hover{border-color:rgba(255,45,45,0.5)}
.check.done{background:linear-gradient(135deg,#ff2d2d,#ff5533);border-color:transparent;box-shadow:0 2px 8px rgba(255,45,45,0.4)}
.check svg{width:10px;height:10px;fill:none;stroke:white;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.vnum{font-size:12px;color:#333340;font-family:'Space Mono',monospace;min-width:28px;text-align:right;flex-shrink:0}
.vtitle{flex:1;font-size:14px;color:#9a9490;line-height:1.4;transition:color .2s}
.vrow:hover .vtitle{color:#c8c4b8}
.vdur{font-size:12px;color:#444440;font-family:'Space Mono',monospace;flex-shrink:0}
.yt-link{
  color:#2a2a3a;font-size:14px;flex-shrink:0;
  text-decoration:none;
  transition:color .2s, transform .2s;
  display:flex;align-items:center;
}
.yt-link:hover{color:#ff2d2d;transform:scale(1.2)}
.action-btns{display:flex;gap:6px}
.act-btn{
  background:none;border:none;color:#555258;font-size:12px;
  cursor:pointer;font-family:'Space Mono',monospace;
  padding:4px 8px;border-radius:6px;
  transition:all .2s ease;
}
.act-btn:hover{color:#ff2d2d;background:rgba(255,45,45,0.08)}

/* LOADING */
.loading-row{padding:2.5rem;display:flex;flex-direction:column;align-items:center;gap:10px}
.spinner{
  width:24px;height:24px;
  border:2.5px solid rgba(255,255,255,0.08);
  border-top-color:#ff2d2d;
  border-radius:50%;
  animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{font-size:14px;color:#555258;font-family:'Space Mono',monospace}
.loading-sub{font-size:12px;color:#333340;font-family:'Space Mono',monospace}
`;

function Ring({ pct, size = 48 }) {
  const r=(size-7)/2, c=2*Math.PI*r, d=(pct/100)*c;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3.5}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#rg)" strokeWidth={3.5}
        strokeDasharray={`${d} ${c}`} strokeLinecap="round" style={{transition:"stroke-dasharray .6s cubic-bezier(.4,0,.2,1)"}}/>
      <defs>
        <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff2d2d"/>
          <stop offset="100%" stopColor="#ff6b35"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

function InfoTab({ videos }) {
  const [activeSpeed, setActiveSpeed] = useState(1.5);
  const totalSec = videos.reduce((s,v)=>s+v.durationSec, 0);
  return (
    <div className="info-panel" style={{margin:"1.25rem 1.75rem"}}>
      <div className="total-dur-box">
        <div className="total-dur-label">Total Duration</div>
        <div className="total-dur-val">{fmtSec(totalSec)}</div>
      </div>
      <div className="speed-section">
        <div className="section-label">Watch time at different speeds</div>
        <div className="speed-grid">
          {SPEEDS.map(sp=>(
            <div key={sp} className={`speed-card${activeSpeed===sp?" active":""}`} onClick={()=>setActiveSpeed(sp)}>
              <div className="speed-lbl">{sp}x</div>
              <div className="speed-time">{fmtSec(Math.floor(totalSec/sp))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayPlanTab({ videos, watched, onToggle }) {
  const [hours, setHours] = useState(1);
  const [mins, setMins] = useState(0);
  const [speed, setSpeed] = useState(1.5);
  const [openDays, setOpenDays] = useState({ 0: true });

  const dailyWallClockSec = (hours * 3600) + (mins * 60);
  const days = dailyWallClockSec > 0 ? buildDayPlan(videos, dailyWallClockSec, speed) : [];
  const watchedIds = new Set(Object.keys(watched));
  const remainingSec = videos.filter(v=>!watchedIds.has(v.id)).reduce((s,v)=>s+v.durationSec,0);
  const daysLeft = days.filter(day=>!day.every(v=>watchedIds.has(v.id))).length;

  return (
    <div className="plan-panel">
      <div className="plan-controls">
        <span className="plan-controls-label">Watch</span>
        <select className="plan-select" value={hours} onChange={e=>setHours(Number(e.target.value))}>
          {HOURS_OPTIONS.map(h=><option key={h} value={h}>{h===0.5?"30 min":`${h} hr${h>1?"s":""}`}</option>)}
        </select>
        <select className="plan-select" value={mins} onChange={e=>setMins(Number(e.target.value))}>
          {MINS_OPTIONS.map(m=><option key={m} value={m}>{m} min</option>)}
        </select>
        <span className="plan-controls-label">per day at</span>
        <select className="plan-select" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>
          {SPEEDS.map(sp=><option key={sp} value={sp}>{sp}x</option>)}
        </select>
      </div>

      <div className="plan-summary">
        <div className="plan-sum-item">
          <span className="plan-sum-val">{days.length}</span>
          <span className="plan-sum-lbl">Total Days</span>
        </div>
        <div className="plan-sum-item">
          <span className="plan-sum-val">{daysLeft}</span>
          <span className="plan-sum-lbl">Days Left</span>
        </div>
        <div className="plan-sum-item">
          <span className="plan-sum-val" style={{fontSize:18}}>{fmtSec(remainingSec)}</span>
          <span className="plan-sum-lbl">Content Left</span>
        </div>
        <div className="plan-sum-item">
          <span className="plan-sum-val" style={{fontSize:18}}>{dailyWallClockSec>0?fmtSec(dailyWallClockSec):"—"}</span>
          <span className="plan-sum-lbl">Per Day</span>
        </div>
      </div>

      {days.map((day, i) => {
        const dayWatched = day.filter(v=>watchedIds.has(v.id)).length;
        const dayDone = dayWatched === day.length;
        const dayPct = Math.round((dayWatched/day.length)*100);
        const daySec = day.reduce((s,v)=>s+v.durationSec,0);
        const isOpen = !!openDays[i];
        return (
          <div key={i} className="day-row">
            <div className="day-row-header" onClick={()=>setOpenDays(o=>({...o,[i]:!o[i]}))}>
              <div className={`day-badge${dayDone?" done":""}`}>{dayDone?"✓ Done":`Day ${i+1}`}</div>
              <div className="day-info">
                <div className="day-title">{day.length} video{day.length!==1?"s":""}</div>
                <div className="day-sub">{fmtSec(daySec)} · {dayWatched}/{day.length} watched</div>
              </div>
              <div className="day-pbar-wrap">
                <div className="day-pbar-track">
                  <div className={`day-pbar-fill${dayDone?" done":""}`} style={{width:`${dayPct}%`}}/>
                </div>
              </div>
              <span className={`day-chevron${isOpen?" open":""}`}>▾</span>
            </div>
            {isOpen && (
              <div className="day-videos">
                {day.map(v=>{
                  const done=watchedIds.has(v.id);
                  return (
                    <div key={v.id} className={`vrow${done?" done":""}`} onClick={()=>onToggle(v.id)}>
                      <div className={`check${done?" done":""}`}>
                        {done&&<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>}
                      </div>
                      {v.thumbnail?<img src={v.thumbnail} className="vthumb" alt=""/>:<div className="vthumb-ph"/>}
                      <span className="vnum">{v.position}</span>
                      <span className="vtitle">{v.title}</span>
                      <span className="vdur">{v.duration}</span>
                      <a href={`https://youtube.com/watch?v=${v.id}`} className="yt-link" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AllVideosTab({ videos, watched, onToggle, onMarkAll }) {
  const [q, setQ] = useState("");
  const filtered = q ? videos.filter(v=>v.title.toLowerCase().includes(q.toLowerCase())) : videos;
  const watchedIds = new Set(Object.keys(watched));
  return (
    <div className="all-videos-wrap">
      <div className="search-bar">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#555258" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input className="search-input" placeholder="Search videos..." value={q} onChange={e=>setQ(e.target.value)}/>
        <div className="action-btns">
          <button className="act-btn" onClick={()=>onMarkAll(true)}>mark all ✓</button>
          <button className="act-btn" onClick={()=>onMarkAll(false)}>clear</button>
        </div>
      </div>
      <div className="video-count-badge">{filtered.length} video{filtered.length!==1?"s":""}{q?` matching "${q}"`:""}  ·  {Object.keys(watched).length} watched</div>
      {filtered.map(v=>{
        const done=watchedIds.has(v.id);
        return (
          <div key={v.id} className={`vrow${done?" done":""}`} onClick={()=>onToggle(v.id)}>
            <div className={`check${done?" done":""}`}>
              {done&&<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>}
            </div>
            {v.thumbnail?<img src={v.thumbnail} className="vthumb" alt=""/>:<div className="vthumb-ph"/>}
            <span className="vnum">{v.position}</span>
            <span className="vtitle">{v.title}</span>
            <span className="vdur">{v.duration}</span>
            <a href={`https://youtube.com/watch?v=${v.id}`} className="yt-link" target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [db, setDb] = useState(()=>loadData());
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState({});
  const [loadingVids, setLoadingVids] = useState({});
  const [loadingMsg, setLoadingMsg] = useState({});
  const [activeTab, setActiveTab] = useState({});

  const persist = useCallback((d)=>{setDb(d);saveData(d);},[]);

  const handleAdd = async () => {
    setErr("");
    const pid = extractPlaylistId(input.trim());
    if(!pid){setErr("⚠ Paste a valid YouTube playlist URL (needs ?list=...)");return;}
    if(db.playlists[pid]){setErr("⚠ Already added!");return;}
    setAdding(true);
    try {
      const meta = await fetchMeta(pid);
      const newDb = {...db, playlists:{...db.playlists,[pid]:{id:pid,...meta,videos:null,watched:{},addedAt:Date.now()}}};
      persist(newDb);
      setInput("");
      setExpanded(e=>({...e,[pid]:true}));
      setActiveTab(t=>({...t,[pid]:"plan"}));
      loadVideos(pid, newDb);
    } catch(e){setErr("⚠ "+( e.message||"Failed. Make sure the playlist is public."));}
    finally{setAdding(false);}
  };

  const loadVideos = async (pid, currentDb) => {
    setLoadingVids(l=>({...l,[pid]:true}));
    setLoadingMsg(l=>({...l,[pid]:"Fetching videos..."}));
    try {
      const videos = await fetchAllVideos(pid, count=>{
        setLoadingMsg(l=>({...l,[pid]:`Loaded ${count} videos so far...`}));
      });
      const updatedDb = {...currentDb, playlists:{...currentDb.playlists,[pid]:{...currentDb.playlists[pid],videos}}};
      persist(updatedDb);
    } catch(e){setLoadingMsg(l=>({...l,[pid]:"Error: "+(e.message||"Failed")}));}
    finally{setLoadingVids(l=>({...l,[pid]:false}));}
  };

  const toggleVideo = (pid, vid) => {
    const pl=db.playlists[pid];
    const watched={...pl.watched};
    if(watched[vid]) delete watched[vid]; else watched[vid]=true;
    persist({...db,playlists:{...db.playlists,[pid]:{...pl,watched}}});
  };

  const markAll = (pid, done) => {
    const pl=db.playlists[pid];
    const watched=done?Object.fromEntries((pl.videos||[]).map(v=>[v.id,true])):{};
    persist({...db,playlists:{...db.playlists,[pid]:{...pl,watched}}});
  };

  const deletePl = (pid) => {
    const {[pid]:_,...rest}=db.playlists;
    persist({...db,playlists:rest});
  };

  const playlists = Object.values(db.playlists).sort((a,b)=>b.addedAt-a.addedAt);
  const totalVids = playlists.reduce((s,p)=>s+(p.videos?.length||0),0);
  const totalWatched = playlists.reduce((s,p)=>s+Object.keys(p.watched).length,0);

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <header className="header">
          <div className="logo-wrap">
            <div className="logo">
              <svg viewBox="0 0 24 24"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg>
            </div>
            <div className="brand">playlist<span>tracker</span></div>
          </div>
          <p className="tagline">// track · plan · complete any youtube playlist</p>
        </header>

        <div className="add-section">
          <div className="input-wrap">
            <input className="url-input" placeholder="Paste YouTube playlist URL here..."
              value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!adding&&handleAdd()}/>
            <button className="add-btn" onClick={handleAdd} disabled={adding||!input.trim()}>
              {adding
                ?<><div className="spinner" style={{width:16,height:16,border:"2.5px solid rgba(255,255,255,0.3)",borderTopColor:"white"}}/>Loading...</>
                :<>+ Add Playlist</>}
            </button>
          </div>
          {err&&<p className="err">{err}</p>}
        </div>

        {playlists.length>0&&(
          <div className="stats-bar">
            <div className="stat-pill"><span>{playlists.length}</span> playlist{playlists.length!==1?"s":""}</div>
            <div className="stat-pill"><span>{totalWatched}</span> / <span>{totalVids}</span> videos watched</div>
            {totalVids>0&&<div className="stat-pill"><span>{Math.round((totalWatched/totalVids)*100)}%</span> overall complete</div>}
          </div>
        )}

        {playlists.length===0
          ?<div className="empty">
              <div className="empty-icon">🎬</div>
              <p className="empty-title">No playlists added yet</p>
              <p className="empty-sub">Paste any public YouTube playlist URL above</p>
            </div>
          :<div className="cards">
              {playlists.map(pl=>{
                const videos=pl.videos||[];
                const watchedCount=Object.keys(pl.watched).length;
                const pct=videos.length>0?Math.round((watchedCount/videos.length)*100):0;
                const isOpen=!!expanded[pl.id];
                const isLoading=!!loadingVids[pl.id];
                const tab=activeTab[pl.id]||"plan";

                return (
                  <div key={pl.id} className="card">
                    <div className="pbar-track"><div className="pbar-fill" style={{width:`${pct}%`}}/></div>
                    <div className="card-header" onClick={()=>setExpanded(e=>({...e,[pl.id]:!e[pl.id]}))}>
                      {pl.thumbnail
                        ?<img src={pl.thumbnail} className="thumb" alt=""/>
                        :<div className="thumb-ph"><svg width="24" height="24" viewBox="0 0 24 24" fill="#333340"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg></div>
                      }
                      <div className="meta">
                        <div className="pl-title">{pl.title}</div>
                        <div className="pl-author">{pl.author} · {videos.length} videos</div>
                      </div>
                      <div className="right-side">
                        <div className="pct-block">
                          <span className="pct-num">{pct}%</span>
                          <span className="pct-sub">{watchedCount}/{videos.length}</span>
                        </div>
                        <Ring pct={pct}/>
                        <span className={`chevron${isOpen?" open":""}`}>▾</span>
                        <button className="del-btn" onClick={e=>{e.stopPropagation();deletePl(pl.id);}}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    {isOpen&&(
                      isLoading
                        ?<div className="loading-row">
                            <div className="spinner"/>
                            <span className="loading-text">{loadingMsg[pl.id]||"Fetching..."}</span>
                            <span className="loading-sub">Large playlists may take a few seconds</span>
                          </div>
                        :videos.length===0
                          ?<div className="loading-row"><span className="loading-text">No videos found</span></div>
                          :<>
                              <div className="tab-bar" onClick={e=>e.stopPropagation()}>
                                {[["plan","📅 Day Plan"],["duration","⏱ Duration"],["all","📋 All Videos"]].map(([id,label])=>(
                                  <button key={id} className={`tab-btn${tab===id?" active":""}`}
                                    onClick={()=>setActiveTab(t=>({...t,[pl.id]:id}))}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                              {tab==="plan"&&<DayPlanTab videos={videos} watched={pl.watched} onToggle={vid=>toggleVideo(pl.id,vid)}/>}
                              {tab==="duration"&&<InfoTab videos={videos}/>}
                              {tab==="all"&&<AllVideosTab videos={videos} watched={pl.watched} onToggle={vid=>toggleVideo(pl.id,vid)} onMarkAll={done=>markAll(pl.id,done)}/>}
                            </>
                    )}
                  </div>
                );
              })}
            </div>
        }
      </div>
    </>
  );
}
