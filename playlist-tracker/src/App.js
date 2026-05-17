import React, { useState, useCallback } from "react";

const YT_API_KEY = "AIzaSyClPjT408pwK4Qdy7qIUwKBKnHaXKMAB74";
const STORAGE_KEY = "yt_tracker_v4";

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

// Build day-wise plan: group videos into days based on daily content budget
// dailyBudgetSec = real wall-clock seconds available per day
// speed = playback speed (e.g. 1.5)
// So content you can consume per day = dailyBudgetSec * speed
function buildDayPlan(videos, dailyWallClockSec, speed) {
  const contentPerDay = dailyWallClockSec * speed; // actual content seconds per day
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
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body,#root{font-family:'Bricolage Grotesque',sans-serif;background:#080810;color:#e8e4d9;min-height:100vh}
.app{max-width:900px;margin:0 auto;padding:2rem 1.5rem 5rem}

.header{margin-bottom:2.5rem}
.header-top{display:flex;align-items:center;gap:12px;margin-bottom:5px}
.logo{width:34px;height:34px;background:#ff2d2d;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.logo svg{width:17px;height:17px;fill:white}
.brand{font-size:23px;font-weight:700;letter-spacing:-0.5px;color:#f0ece0}
.tagline{font-size:13px;color:#555250;font-family:'DM Mono',monospace}

.add-section{margin-bottom:2rem}
.input-row{display:flex;gap:10px}
.url-input{flex:1;background:#0f0f1a;border:1px solid #22222e;color:#e8e4d9;border-radius:10px;padding:13px 16px;font-size:14px;font-family:'DM Mono',monospace;outline:none;transition:border-color .2s}
.url-input::placeholder{color:#333340}
.url-input:focus{border-color:#ff2d2d}
.add-btn{background:#ff2d2d;color:white;border:none;border-radius:10px;padding:13px 22px;font-size:14px;font-weight:600;cursor:pointer;font-family:'Bricolage Grotesque',sans-serif;transition:background .2s,transform .1s;white-space:nowrap;display:flex;align-items:center;gap:7px}
.add-btn:hover{background:#ff5050}
.add-btn:active{transform:scale(0.97)}
.add-btn:disabled{background:#2a1a1a;color:#5a3030;cursor:not-allowed}
.err{font-size:12px;color:#ff7070;margin-top:8px;font-family:'DM Mono',monospace}

.stats-bar{display:flex;gap:10px;margin-bottom:1.5rem;flex-wrap:wrap}
.stat-pill{background:#0f0f1a;border:1px solid #1e1e2a;border-radius:8px;padding:7px 13px;font-family:'DM Mono',monospace;font-size:12px;color:#555250}
.stat-pill span{color:#e8e4d9;font-weight:500}

.empty{text-align:center;padding:4rem 2rem}
.empty-icon{font-size:44px;margin-bottom:1rem}
.empty-title{font-size:17px;font-weight:600;color:#888480;margin-bottom:6px}
.empty-sub{font-size:12px;color:#3a3835;font-family:'DM Mono',monospace}

.cards{display:flex;flex-direction:column;gap:1.5rem}
.card{background:#0c0c16;border:1px solid #1a1a26;border-radius:14px;overflow:hidden;transition:border-color .2s}
.card:hover{border-color:#2a2a3a}
.pbar-track{height:2px;background:#1a1a26}
.pbar-fill{height:100%;background:#ff2d2d;transition:width .5s ease}

.card-header{padding:1.25rem 1.5rem;display:flex;align-items:center;gap:14px;cursor:pointer;user-select:none}
.thumb{width:58px;height:44px;border-radius:7px;object-fit:cover;background:#1a1a26;flex-shrink:0}
.thumb-ph{width:58px;height:44px;border-radius:7px;background:#1a1a26;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.meta{flex:1;min-width:0}
.pl-title{font-size:15px;font-weight:600;color:#f0ece0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
.pl-author{font-size:12px;color:#555250;font-family:'DM Mono',monospace}
.right-side{display:flex;align-items:center;gap:10px;flex-shrink:0}
.pct-block{text-align:right}
.pct-num{font-size:16px;font-weight:700;color:#ff2d2d;display:block;line-height:1}
.pct-sub{font-size:11px;color:#555250;font-family:'DM Mono',monospace}
.chevron{color:#333340;font-size:15px;transition:transform .2s;flex-shrink:0}
.chevron.open{transform:rotate(180deg)}
.del-btn{background:none;border:none;color:#333340;cursor:pointer;padding:5px;border-radius:6px;transition:color .15s,background .15s;display:flex;align-items:center;flex-shrink:0}
.del-btn:hover{color:#ff7070;background:#1e1010}

/* Tab switcher */
.tab-bar{display:flex;gap:2px;padding:12px 1.5rem 0;border-bottom:1px solid #1a1a26}
.tab-btn{background:none;border:none;color:#555250;font-size:13px;font-family:'Bricolage Grotesque',sans-serif;font-weight:600;cursor:pointer;padding:8px 14px;border-radius:8px 8px 0 0;transition:all .2s;border-bottom:2px solid transparent;margin-bottom:-1px}
.tab-btn:hover{color:#aaa49a}
.tab-btn.active{color:#ff2d2d;border-bottom-color:#ff2d2d;background:#0f0f1a}

/* Info panel (duration + speed) */
.info-panel{margin:1rem 1.5rem;background:#0a0a14;border:1px solid #1a1a26;border-radius:10px;overflow:hidden}
.total-dur-box{padding:.85rem 1.25rem;text-align:center;border-bottom:1px solid #1a1a26}
.total-dur-label{font-size:10px;letter-spacing:1.5px;color:#555250;font-family:'DM Mono',monospace;text-transform:uppercase;margin-bottom:3px}
.total-dur-val{font-size:20px;font-weight:700;color:#f0ece0}
.speed-section{padding:.85rem 1.25rem}
.section-label{font-size:10px;letter-spacing:1.5px;color:#555250;font-family:'DM Mono',monospace;text-transform:uppercase;margin-bottom:8px}
.speed-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.speed-card{background:#0f0f1a;border:1px solid #1e1e2a;border-radius:8px;padding:7px 4px;text-align:center;cursor:pointer;transition:all .2s}
.speed-card:hover{border-color:#ff2d2d}
.speed-card.active{border-color:#ff2d2d;background:#1a0808}
.speed-lbl{font-size:10px;color:#555250;font-family:'DM Mono',monospace;margin-bottom:3px}
.speed-time{font-size:12px;font-weight:600;color:#e8e4d9}
.speed-card.active .speed-time{color:#ff2d2d}

/* Day Plan panel */
.plan-panel{margin:0 1.5rem 1rem;background:#0a0a14;border:1px solid #1a1a26;border-radius:10px;overflow:hidden}

.plan-controls{padding:1rem 1.25rem;border-bottom:1px solid #1a1a26;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.plan-controls-label{font-size:13px;color:#888480;margin-right:4px}
.plan-select{background:#0f0f1a;border:1px solid #22222e;color:#e8e4d9;border-radius:7px;padding:7px 10px;font-size:13px;font-family:'DM Mono',monospace;outline:none;cursor:pointer;transition:border-color .2s}
.plan-select:focus{border-color:#ff2d2d}

.plan-summary{padding:.85rem 1.25rem;border-bottom:1px solid #1a1a26;display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap}
.plan-sum-item{text-align:center}
.plan-sum-val{font-size:22px;font-weight:700;color:#ff2d2d;display:block;line-height:1}
.plan-sum-lbl{font-size:11px;color:#555250;font-family:'DM Mono',monospace}
.plan-sum-divider{width:1px;height:36px;background:#1a1a26;flex-shrink:0}

/* Day rows */
.day-row{border-bottom:1px solid #0f0f18;cursor:pointer;transition:background .15s}
.day-row:last-child{border-bottom:none}
.day-row:hover{background:#0f0f1c}
.day-row-header{padding:.85rem 1.25rem;display:flex;align-items:center;gap:12px}
.day-badge{background:#1a0a0a;border:1px solid #2a1515;color:#ff2d2d;font-size:12px;font-weight:700;font-family:'DM Mono',monospace;padding:3px 10px;border-radius:20px;flex-shrink:0;white-space:nowrap}
.day-badge.done{background:#0a1a0a;border-color:#155215;color:#4caf50}
.day-info{flex:1;min-width:0}
.day-title{font-size:14px;font-weight:600;color:#c8c4b8;margin-bottom:2px}
.day-sub{font-size:11px;color:#444440;font-family:'DM Mono',monospace}
.day-pbar-wrap{width:100px;flex-shrink:0}
.day-pbar-track{height:4px;background:#1a1a26;border-radius:2px}
.day-pbar-fill{height:100%;background:#ff2d2d;border-radius:2px;transition:width .4s}
.day-pbar-fill.done{background:#4caf50}
.day-chevron{color:#2a2a3a;font-size:13px;transition:transform .2s;flex-shrink:0}
.day-chevron.open{transform:rotate(180deg)}

/* Videos inside a day */
.day-videos{background:#070710;border-top:1px solid #0f0f18}
.vrow{display:flex;align-items:center;gap:10px;padding:9px 1.25rem;transition:background .15s;cursor:pointer;border-bottom:1px solid #0a0a14}
.vrow:last-child{border-bottom:none}
.vrow:hover{background:#0e0e1c}
.vrow.done .vtitle{color:#3a3835;text-decoration:line-through;text-decoration-color:#2a2825}
.vthumb{width:48px;height:36px;border-radius:5px;object-fit:cover;background:#1a1a26;flex-shrink:0}
.vthumb-ph{width:48px;height:36px;border-radius:5px;background:#1a1a26;flex-shrink:0}
.check{width:18px;height:18px;border-radius:50%;border:1.5px solid #252535;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s;background:transparent}
.check.done{background:#ff2d2d;border-color:#ff2d2d}
.check svg{width:9px;height:9px;fill:none;stroke:white;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.vnum{font-size:11px;color:#333340;font-family:'DM Mono',monospace;min-width:24px;text-align:right;flex-shrink:0}
.vtitle{flex:1;font-size:13px;color:#9a9490;line-height:1.35;transition:color .15s}
.vdur{font-size:11px;color:#444440;font-family:'DM Mono',monospace;flex-shrink:0}
.yt-link{color:#2a2a3a;font-size:13px;flex-shrink:0;text-decoration:none;transition:color .15s;display:flex;align-items:center}
.yt-link:hover{color:#ff2d2d}

/* All videos tab */
.all-videos-wrap{padding:4px 0}
.search-bar{padding:8px 1.5rem 4px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #0c0c16}
.search-input{flex:1;background:transparent;border:none;outline:none;font-size:13px;color:#aaa49a;font-family:'DM Mono',monospace;padding:4px 0}
.search-input::placeholder{color:#333340}
.video-count-badge{font-size:11px;font-family:'DM Mono',monospace;color:#444440;padding:6px 1.5rem 8px}
.action-btns{display:flex;gap:6px}
.act-btn{background:none;border:none;color:#555250;font-size:11px;cursor:pointer;font-family:'DM Mono',monospace;padding:3px 7px;border-radius:4px;transition:color .15s}
.act-btn:hover{color:#ff2d2d}

.loading-row{padding:2rem;display:flex;flex-direction:column;align-items:center;gap:8px}
.spinner{width:20px;height:20px;border:2px solid #1e1e2a;border-top-color:#ff2d2d;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{font-size:13px;color:#555250;font-family:'DM Mono',monospace}
.loading-sub{font-size:11px;color:#333340;font-family:'DM Mono',monospace}
`;

function Ring({ pct, size = 42 }) {
  const r=(size-6)/2, c=2*Math.PI*r, d=(pct/100)*c;
  return (
    <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a26" strokeWidth={3}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#ff2d2d" strokeWidth={3}
        strokeDasharray={`${d} ${c}`} strokeLinecap="round" style={{transition:"stroke-dasharray .5s ease"}}/>
    </svg>
  );
}

function InfoTab({ videos }) {
  const [activeSpeed, setActiveSpeed] = useState(1.5);
  const totalSec = videos.reduce((s,v)=>s+v.durationSec, 0);
  return (
    <div className="info-panel" style={{margin:"1rem 1.5rem"}}>
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

  const totalSec = videos.reduce((s,v)=>s+v.durationSec,0);
  const watchedIds = new Set(Object.keys(watched));
  const remainingSec = videos.filter(v=>!watchedIds.has(v.id)).reduce((s,v)=>s+v.durationSec,0);
  const daysLeft = days.filter(day=>!day.every(v=>watchedIds.has(v.id))).length;

  const toggleDay = (i) => setOpenDays(o=>({...o,[i]:!o[i]}));

  return (
    <div className="plan-panel">
      {/* Controls */}
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

      {/* Summary */}
      <div className="plan-summary">
        <div className="plan-sum-item">
          <span className="plan-sum-val">{days.length}</span>
          <span className="plan-sum-lbl">Total Days</span>
        </div>
        <div className="plan-sum-divider"/>
        <div className="plan-sum-item">
          <span className="plan-sum-val">{daysLeft}</span>
          <span className="plan-sum-lbl">Days Left</span>
        </div>
        <div className="plan-sum-divider"/>
        <div className="plan-sum-item">
          <span className="plan-sum-val">{fmtSec(remainingSec)}</span>
          <span className="plan-sum-lbl">Content Left</span>
        </div>
        <div className="plan-sum-divider"/>
        <div className="plan-sum-item">
          <span className="plan-sum-val">{hours>0||mins>0?fmtSec(((hours*3600)+(mins*60))):"—"}</span>
          <span className="plan-sum-lbl">Per Day</span>
        </div>
      </div>

      {/* Day rows */}
      {days.map((day, i) => {
        const dayWatched = day.filter(v=>watchedIds.has(v.id)).length;
        const dayDone = dayWatched === day.length;
        const dayPct = Math.round((dayWatched/day.length)*100);
        const daySec = day.reduce((s,v)=>s+v.durationSec,0);
        const isOpen = !!openDays[i];
        return (
          <div key={i} className="day-row">
            <div className="day-row-header" onClick={()=>toggleDay(i)}>
              <div className={`day-badge${dayDone?" done":""}`}>
                {dayDone ? "✓ Done" : `Day ${i+1}`}
              </div>
              <div className="day-info">
                <div className="day-title">{day.length} video{day.length!==1?"s":""}</div>
                <div className="day-sub">{fmtSec(daySec)} of content · {dayWatched}/{day.length} watched</div>
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
                      {v.thumbnail
                        ? <img src={v.thumbnail} className="vthumb" alt=""/>
                        : <div className="vthumb-ph"/>
                      }
                      <span className="vnum">{v.position}</span>
                      <span className="vtitle">{v.title}</span>
                      <span className="vdur">{v.duration}</span>
                      <a href={`https://youtube.com/watch?v=${v.id}`}
                        className="yt-link" target="_blank" rel="noopener noreferrer"
                        onClick={e=>e.stopPropagation()} title="Watch on YouTube">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555250" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input className="search-input" placeholder="Search videos..." value={q} onChange={e=>setQ(e.target.value)}/>
        <div className="action-btns">
          <button className="act-btn" onClick={()=>onMarkAll(true)}>mark all ✓</button>
          <button className="act-btn" onClick={()=>onMarkAll(false)}>clear</button>
        </div>
      </div>
      <div className="video-count-badge">
        {filtered.length} video{filtered.length!==1?"s":""}{q?` matching "${q}"`:""}
        {" · "}{Object.keys(watched).length} watched
      </div>
      {filtered.map(v=>{
        const done=watchedIds.has(v.id);
        return (
          <div key={v.id} className={`vrow${done?" done":""}`} onClick={()=>onToggle(v.id)}>
            <div className={`check${done?" done":""}`}>
              {done&&<svg viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3"/></svg>}
            </div>
            {v.thumbnail
              ? <img src={v.thumbnail} className="vthumb" alt=""/>
              : <div className="vthumb-ph"/>
            }
            <span className="vnum">{v.position}</span>
            <span className="vtitle">{v.title}</span>
            <span className="vdur">{v.duration}</span>
            <a href={`https://youtube.com/watch?v=${v.id}`}
              className="yt-link" target="_blank" rel="noopener noreferrer"
              onClick={e=>e.stopPropagation()} title="Watch on YouTube">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    if(!pid){setErr("Paste a valid YouTube playlist URL (needs ?list=...)");return;}
    if(db.playlists[pid]){setErr("Already added!");return;}
    setAdding(true);
    try {
      const meta = await fetchMeta(pid);
      const newDb = {...db, playlists:{...db.playlists,[pid]:{id:pid,...meta,videos:null,watched:{},addedAt:Date.now()}}};
      persist(newDb);
      setInput("");
      setExpanded(e=>({...e,[pid]:true}));
      setActiveTab(t=>({...t,[pid]:"plan"}));
      loadVideos(pid, newDb);
    } catch(e){setErr(e.message||"Failed. Make sure the playlist is public.");}
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
          <div className="header-top">
            <div className="logo"><svg viewBox="0 0 24 24"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg></div>
            <span className="brand">playlist tracker</span>
          </div>
          <p className="tagline">// track any youtube playlist · day-wise plan · saves progress</p>
        </header>

        <div className="add-section">
          <div className="input-row">
            <input className="url-input" placeholder="https://youtube.com/playlist?list=PLxxxxxx"
              value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!adding&&handleAdd()}/>
            <button className="add-btn" onClick={handleAdd} disabled={adding||!input.trim()}>
              {adding
                ?<><div className="spinner" style={{width:14,height:14,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white"}}/>Adding...</>
                :<>+ Add Playlist</>}
            </button>
          </div>
          {err&&<p className="err">⚠ {err}</p>}
        </div>

        {playlists.length>0&&(
          <div className="stats-bar">
            <div className="stat-pill"><span>{playlists.length}</span> playlist{playlists.length!==1?"s":""}</div>
            <div className="stat-pill"><span>{totalWatched}</span> / <span>{totalVids}</span> watched</div>
            {totalVids>0&&<div className="stat-pill"><span>{Math.round((totalWatched/totalVids)*100)}%</span> overall</div>}
          </div>
        )}

        {playlists.length===0
          ?<div className="empty">
              <div className="empty-icon">▶</div>
              <p className="empty-title">No playlists yet</p>
              <p className="empty-sub">Paste any public YouTube playlist URL above to start tracking</p>
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
                        :<div className="thumb-ph"><svg width="20" height="20" viewBox="0 0 24 24" fill="#333340"><path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/></svg></div>
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
                        <button className="del-btn" onClick={e=>{e.stopPropagation();deletePl(pl.id);}} title="Remove">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                              {tab==="plan" && <DayPlanTab videos={videos} watched={pl.watched} onToggle={vid=>toggleVideo(pl.id,vid)}/>}
                              {tab==="duration" && <InfoTab videos={videos}/>}
                              {tab==="all" && <AllVideosTab videos={videos} watched={pl.watched} onToggle={vid=>toggleVideo(pl.id,vid)} onMarkAll={done=>markAll(pl.id,done)}/>}
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
