"""Generates the standalone design templates from real notebook outputs.
Run:  python docs/design/build_templates.py   (from the repo root)
"""
import json, pandas as pd, pathlib

root = pathlib.Path(__file__).resolve().parents[2]
out = root / "docs" / "design"
fc = pd.read_csv(root / "outputs" / "wind_24_hour_predictions.csv")
lead = pd.read_csv(root / "outputs" / "backtest_metrics_by_lead.csv")
summ = pd.read_csv(root / "outputs" / "backtest_summary.csv")

rows = []
for _, r in fc.iterrows():
    rows.append(dict(t=r.timestamp_local[-5:], lead=int(r.lead_h), speed=round(r.pred_speed_100m_ms, 2),
                     dir=round(r.pred_direction_deg), conf=round(min(1.0, r.direction_confidence), 2),
                     ok=bool(r.direction_reliable), head=None if pd.isna(r.recommended_nacelle_heading_deg) else round(r.recommended_nacelle_heading_deg),
                     note=r.yaw_note, kw=round(r.power_kw), kwh=round(r.energy_kwh)))
cmp = json.load(open(root / "outputs" / "compare_sample_2026-10-22.json"))
DATA = dict(cmp=cmp, rows=rows,
            lead=lead.round(3).to_dict("records"),
            summary=summ.round(3).to_dict("records"),
            origin=fc.forecast_origin_utc.iloc[0], total=round(float(fc.energy_kwh.sum())))

CSS = """
:root{--bg:#F6F8FB;--surface:#fff;--border:#E3E8EF;--text:#0E1726;--muted:#5B6B80;--accent:#0891B2;--accent2:#7C3AED;
--good:#059669;--warn:#B45309;--bad:#DC2626;--grid:#E9EEF5;--glow:rgba(8,145,178,.12);--r:14px}
[data-theme=dark]{--bg:#0A0E14;--surface:#111823;--border:#1E2A3A;--text:#E6EDF5;--muted:#8A99AD;--accent:#22D3EE;--accent2:#A78BFA;
--good:#34D399;--warn:#FBBF24;--bad:#F87171;--grid:#172232;--glow:rgba(34,211,238,.14)}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;
background-image:radial-gradient(900px 400px at 85% -10%,var(--glow),transparent)}
.mono{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace}
.wrap{max-width:1240px;margin:0 auto;padding:0 20px 60px}
header{display:flex;align-items:center;gap:16px;padding:18px 0;position:sticky;top:0;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(10px);z-index:5}
.logo{font-weight:600;letter-spacing:.14em;font-size:13px;display:flex;align-items:center;gap:10px}
.logo i{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 14px var(--accent)}
.spacer{flex:1}.chip{font-size:12px;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:99px;display:inline-flex;gap:8px;align-items:center}
.dot{width:7px;height:7px;border-radius:50%;background:var(--good);animation:p 2.4s infinite}
@keyframes p{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.dot{animation:none}}
button{font:inherit;color:var(--text);background:transparent;border:1px solid var(--border);border-radius:10px;padding:7px 13px;cursor:pointer;transition:.15s}
button:hover{border-color:var(--accent);box-shadow:0 0 0 3px var(--glow)}button.primary{background:var(--accent);color:#04121a;border-color:transparent;font-weight:600}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:20px}
.grid{display:grid;gap:16px}.g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:2fr 1fr}.g22{grid-template-columns:1fr 1fr}
@media(max-width:960px){.g4,.g3,.g2,.g22{grid-template-columns:1fr 1fr}}@media(max-width:620px){.g4,.g3,.g2,.g22{grid-template-columns:1fr}}
h2{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:34px 0 14px}
h3{font-size:14px;font-weight:500;margin-bottom:2px}.sub{color:var(--muted);font-size:12px;margin-bottom:12px}
.kpi .v{font-size:34px;font-weight:300;letter-spacing:-.02em;margin:6px 0 0}.kpi .u{font-size:13px;color:var(--muted);margin-left:4px}
.kpi .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
svg{width:100%;height:auto;display:block}svg text{fill:var(--muted);font-size:10.5px;font-family:inherit}
table{width:100%;border-collapse:collapse;font-size:13px}th{font-weight:500;color:var(--muted);text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:8px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface)}
td{padding:8px 10px;border-bottom:1px solid var(--grid)}tr:hover td{background:var(--grid)}td.n,th.n{text-align:right}
.scroll{max-height:380px;overflow:auto;border-radius:10px}
.badge{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid currentColor}.b-g{color:var(--good)}.b-w{color:var(--warn)}.b-m{color:var(--muted)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
input,select{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:9px 12px;width:100%}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--glow)}label{font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:6px}
.note{color:var(--muted);font-size:12px;border-left:2px solid var(--accent);padding-left:12px;margin-top:14px}
footer{margin-top:50px;color:var(--muted);font-size:12px}details summary{cursor:pointer;color:var(--text)}
"""

JS_LIB = """
const $=s=>document.querySelector(s);
const cssv=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function setTheme(t){document.documentElement.dataset.theme=t;try{localStorage.setItem('theme',t)}catch(e){}if(window.draw)draw()}
let _t='dark';try{_t=localStorage.getItem('theme')||'dark'}catch(e){}
document.documentElement.dataset.theme=_t;
function toggleTheme(){setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark')}
// minimal SVG line/bar chart helper
function chart(el,{w=640,h=240,series=[],bars=null,xs=[],ymin=null,ymax=null,unit='',yticks=4,area=false}){
  const p={l:42,r:12,t:10,b:26},iw=w-p.l-p.r,ih=h-p.t-p.b;
  const all=series.flatMap(s=>s.y.filter(v=>v!=null)).concat(bars?bars.y:[]);
  let lo=ymin??Math.min(0,...all),hi=ymax??Math.max(...all)*1.1;if(hi===lo)hi=lo+1;
  const X=i=>p.l+(xs.length>1?i*iw/(xs.length-1):iw/2),Y=v=>p.t+ih-(v-lo)/(hi-lo)*ih;
  let s=`<svg viewBox="0 0 ${w} ${h}" role="img">`;
  for(let k=0;k<=yticks;k++){const v=lo+(hi-lo)*k/yticks,y=Y(v);s+=`<line x1="${p.l}" x2="${w-p.r}" y1="${y}" y2="${y}" stroke="${cssv('--grid')}"/><text x="${p.l-8}" y="${y+3}" text-anchor="end">${v.toFixed(v%1?1:0)}</text>`}
  const step=Math.ceil(xs.length/8);xs.forEach((x,i)=>{if(i%step===0)s+=`<text x="${X(i)}" y="${h-8}" text-anchor="middle">${x}</text>`});
  if(bars){const bw=Math.max(3,iw/xs.length*.6);bars.y.forEach((v,i)=>{s+=`<rect x="${X(i)-bw/2}" y="${Y(v)}" width="${bw}" height="${Math.max(0,Y(lo)-Y(v))}" rx="3" fill="${bars.color}" opacity=".85"><title>${xs[i]}: ${v}${unit}</title></rect>`})}
  series.forEach(se=>{const pts=se.y.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean);
    if(se.dots){pts.forEach((q,i)=>s+=`<circle cx="${q[0]}" cy="${q[1]}" r="3" fill="${se.color}"><title>${xs[i]}: ${se.y[i]}${unit}</title></circle>`);return}
    const d=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join('');
    if(area)s+=`<path d="${d}L${pts.at(-1)[0]} ${Y(lo)}L${pts[0][0]} ${Y(lo)}Z" fill="${se.color}" opacity=".10"/>`;
    s+=`<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" ${se.dash?'stroke-dasharray="5 4"':''}/>`;
    if(se.marks)pts.forEach((q,i)=>s+=`<circle cx="${q[0]}" cy="${q[1]}" r="3.2" fill="${se.color}"><title>${se.name} ${xs[i]}: ${se.y[i]}${unit}</title></circle>`)});
  el.innerHTML=s+'</svg>'}
function compass(el,deg,ok){const c=100,r=78;let s=`<svg viewBox="0 0 200 200" style="max-width:220px;margin:auto">
<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${cssv('--border')}" stroke-width="1.5"/><circle cx="${c}" cy="${c}" r="${r-24}" fill="none" stroke="${cssv('--grid')}"/>`;
  for(let a=0;a<360;a+=30){const t=a*Math.PI/180,l=a%90?4:9;s+=`<line x1="${c+Math.sin(t)*r}" y1="${c-Math.cos(t)*r}" x2="${c+Math.sin(t)*(r-l)}" y2="${c-Math.cos(t)*(r-l)}" stroke="${cssv('--muted')}"/>`}
  [['N',0],['E',90],['S',180],['W',270]].forEach(([n,a])=>{const t=a*Math.PI/180;s+=`<text x="${c+Math.sin(t)*(r+14)}" y="${c-Math.cos(t)*(r+14)+4}" text-anchor="middle">${n}</text>`});
  const col=ok?cssv('--accent'):cssv('--muted');
  s+=`<g transform="rotate(${deg} ${c} ${c})"><path d="M${c} ${c-r+8}L${c+7} ${c+6}L${c} ${c-2}L${c-7} ${c+6}Z" fill="${col}"/><line x1="${c}" y1="${c-2}" x2="${c}" y2="${c+r-30}" stroke="${col}" stroke-opacity=".35" stroke-dasharray="3 4"/></g>
<circle cx="${c}" cy="${c}" r="4" fill="${col}"/></svg>`;el.innerHTML=s}
"""

TOP = lambda active: f"""<header><div class="logo"><i></i>WINDKRAFT</div>
<span class="chip mono"><span class="dot"></span><span id="origin"></span></span><div class="spacer"></div>
<span class="chip">Design template · sample data from real model output</span><button onclick="toggleTheme()" aria-label="Toggle theme">◐ Theme</button></header>"""

# ------------------------------------------------------------------ dashboard
dash = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WindKraft Dashboard (design template)</title><style>{CSS}</style></head><body><div class="wrap">
{TOP('dash')}
<div class="grid g4" id="kpis"></div>

<h2>Forecast · next 24 h</h2>
<div class="grid g2">
 <div class="card"><h3>Wind speed @ 100 m</h3><div class="sub">ML model only · hub-height power uses the NREL curve</div><div id="c-speed"></div>
  <div class="legend"><span><i style="background:var(--accent)"></i>LightGBM forecast</span><span><i style="background:var(--muted)"></i>cut-in 3 m/s</span></div></div>
 <div class="card"><h3>Recommended heading</h3><div class="sub" id="cmp-sub"></div><div id="compass"></div>
  <div style="text-align:center;margin-top:6px"><span class="mono" style="font-size:28px;font-weight:300" id="cmp-deg"></span> <span class="badge b-g" id="cmp-b"></span></div></div>
</div>
<div class="grid g22" style="margin-top:16px">
 <div class="card"><h3>Wind direction (from)</h3><div class="sub">degrees · markers only where direction is reliable</div><div id="c-dir"></div></div>
 <div class="card"><h3>Direction confidence</h3><div class="sub">predicted vector magnitude R · threshold 0.75</div><div id="c-conf"></div></div>
</div>
<div class="card" style="margin-top:16px"><h3>Hourly power &amp; energy</h3><div class="sub">kW per hour = kWh · idealised curve, no wake or availability losses</div><div id="c-pow"></div></div>

<h2>Forecast table</h2>
<div class="card"><div style="display:flex;gap:10px;margin-bottom:12px"><div class="spacer"></div><button>Export CSV</button><button>Export JSON</button></div>
<div class="scroll"><table id="t-fc"></table></div></div>

<h2>Model quality · held-out rolling backtest (596 origins)</h2>
<div class="grid g3">
 <div class="card"><h3>Speed MAE by lead</h3><div class="sub">m/s · lower is better</div><div id="m-mae"></div></div>
 <div class="card"><h3>Speed RMSE by lead</h3><div class="sub">m/s</div><div id="m-rmse"></div></div>
 <div class="card"><h3>Direction circular MAE</h3><div class="sub">degrees · observed wind ≥ 3 m/s</div><div id="m-dir"></div></div>
</div>
<div class="legend" id="m-leg" style="margin:10px 0 16px"></div>
<div class="card"><h3>Metrics summary</h3><div class="sub">winner highlighted · all models scored on identical origins</div><div class="scroll"><table id="t-m"></table></div>
<p class="note">LightGBM is the selected model for speed and direction. Errors are measured against reanalysis, not a site anemometer.</p></div>

<h2>Accuracy check · model vs Forecast API vs what happened</h2>
<div class="card" style="margin-bottom:16px;display:flex;gap:14px;align-items:end;flex-wrap:wrap">
 <div style="min-width:170px"><label>Forecast date</label><input class="mono" value="2026-10-22" type="date"></div>
 <div style="min-width:150px"><label>Compare</label><select><option>Single date</option><option>Last 7 days</option><option>Full held-out period (150 d)</option></select></div>
 <div class="spacer"></div><button class="primary">Run accuracy check</button></div>
<div class="grid g2">
 <div class="card"><h3>Wind speed · <span class="mono" id="a-date"></span></h3><div class="sub">observed reanalysis vs ML model vs Forecast API (forecast issued the previous day)</div><div id="a-speed"></div>
  <div class="legend"><span><i style="background:var(--text)"></i>observed</span><span><i style="background:var(--accent)"></i>ML model</span><span><i style="background:var(--warn)"></i>Forecast API</span></div></div>
 <div class="card"><h3>Who was closer?</h3><div class="sub">same timestamps, same observations</div><table id="a-t"></table>
  <p class="note">The Forecast API is not ground truth, it is another forecast. Accuracy is measured against observed values only.</p></div>
</div>
<div class="card" style="margin-top:16px"><h3>Hourly detail</h3><div class="sub">matched timestamps · error = forecast minus observed</div><div class="scroll"><table id="a-d"></table></div>
<p class="note">Fair-comparison rule: every date in this section is out-of-sample. The model is trained only on data before that date, and the Forecast API is never an input to the model.</p></div>

<h2>Data &amp; assumptions</h2>
<div class="grid g22">
 <div class="card"><h3>Data quality</h3><div class="sub">validated hourly dataset</div><table>
  <tr><td>Rows</td><td class="n mono">26,328</td></tr><tr><td>Duplicates</td><td class="n mono">0</td></tr>
  <tr><td>Interpolated hours (≤ 3 h gaps)</td><td class="n mono">see run</td></tr><tr><td>Units</td><td class="n mono">m/s · °</td></tr>
  <tr><td>Height</td><td class="n mono">100 m (modelled)</td></tr><tr><td>Last observation</td><td class="n mono" id="q-last"></td></tr></table></div>
 <div class="card"><h3>Limitations</h3><div class="sub">always visible</div>
  <details open><summary>Read before relying on this</summary><ul style="margin:10px 0 0 18px;color:var(--muted)">
  <li>Reanalysis data, not a site sensor</li><li>Archive lags real time by several days</li><li>Energy is curve-based, no observed generation</li><li>Yaw output is advisory only</li></ul></details></div>
</div>
<footer>WindKraft · advisory predictions only · no turbine commands are issued</footer></div>
<script>{JS_LIB}
const D={json.dumps(DATA)};
const R=D.rows,xs=R.map(r=>r.t);
const sum=a=>a.reduce((x,y)=>x+y,0);
$('#origin').textContent='origin '+D.origin.slice(0,16)+' UTC';$('#q-last').textContent=D.origin.slice(0,16);
const rel=R.filter(r=>r.ok).length,peak=Math.max(...R.map(r=>r.kw));
$('#kpis').innerHTML=[['Expected energy',D.total.toLocaleString(),'kWh'],['Capacity factor',(D.total/(3300*24)*100).toFixed(1),'%'],
['Peak power',peak.toLocaleString(),'kW'],['Mean speed',(sum(R.map(r=>r.speed))/R.length).toFixed(1),'m/s']]
.map(k=>`<div class="card kpi"><div class="l">${{k[0]}}</div><div class="v mono">${{k[1]}}<span class="u">${{k[2]}}</span></div></div>`).join('');
const next=R.find(r=>r.head!=null);$('#cmp-sub').textContent=rel+' of 24 hours have reliable direction';
$('#cmp-deg').textContent=next.head+'°';$('#cmp-b').textContent='track wind';
const leads=[...new Set(D.lead.map(r=>r.lead_h))],models=[...new Set(D.lead.map(r=>r.model))];
const col={{'Persistence':'#8A99AD','Seasonal naive (24h)':'#FBBF24','SARIMAX':'#A78BFA','LightGBM':'#22D3EE'}};
$('#m-leg').innerHTML=models.map(m=>`<span style="margin-right:16px"><i style="display:inline-block;width:10px;height:3px;background:${{col[m]}};margin-right:6px;vertical-align:middle"></i>${{m}}</span>`).join('');
window.draw=function(){{
 chart($('#c-speed'),{{xs,series:[{{name:'speed',y:R.map(r=>r.speed),color:cssv('--accent')}},{{name:'cut-in',y:R.map(_=>3),color:cssv('--muted'),dash:true}}],area:true,unit:' m/s',ymin:0}});
 chart($('#c-dir'),{{xs,series:[{{name:'dir',y:R.map(r=>r.ok?r.dir:null),color:cssv('--accent2'),dots:true}}],unit:'°',ymin:0,ymax:360,yticks:4}});
 chart($('#c-conf'),{{xs,bars:{{y:R.map(r=>r.conf),color:cssv('--accent')}},series:[{{name:'thr',y:R.map(_=>.75),color:cssv('--warn'),dash:true}}],ymin:0,ymax:1,unit:''}});
 chart($('#c-pow'),{{xs,h:220,bars:{{y:R.map(r=>r.kwh),color:cssv('--accent2')}},series:[],unit:' kWh',ymin:0}});
 compass($('#compass'),next.head,true);
 const L=(k,el)=>chart($(el),{{w:420,h:220,xs:leads,series:models.map(m=>({{name:m,y:leads.map(l=>D.lead.find(r=>r.model===m&&r.lead_h===l)[k]),color:col[m],marks:true}})),unit:'',ymin:0}});
 L('speed_MAE','#m-mae');L('speed_RMSE','#m-rmse');L('dir_CMAE_fast','#m-dir');
}};
$('#t-fc').innerHTML='<thead><tr><th>Lead</th><th>Local</th><th class="n">Speed m/s</th><th class="n">Dir °</th><th class="n">Conf</th><th class="n">Heading °</th><th>Yaw note</th><th class="n">Power kW</th><th class="n">Energy kWh</th></tr></thead><tbody>'+
 R.map(r=>`<tr><td class="mono">+${{r.lead}}h</td><td class="mono">${{r.t}}</td><td class="n mono">${{r.speed.toFixed(2)}}</td><td class="n mono">${{r.dir}}</td><td class="n mono">${{r.conf.toFixed(2)}}</td><td class="n mono">${{r.head??'—'}}</td><td><span class="badge ${{r.ok?'b-g':'b-m'}}">${{r.note.split(':')[0]}}</span> <span style="color:var(--muted)">${{r.note.includes(':')?r.note.split(': ')[1]:''}}</span></td><td class="n mono">${{r.kw}}</td><td class="n mono">${{r.kwh}}</td></tr>`).join('')+'</tbody>';
const S=D.summary,best=Math.min(...S.map(r=>r['RMSE_1-24h']||9));
$('#t-m').innerHTML='<thead><tr><th>Model</th><th class="n">MAE@1h</th><th class="n">MAE@6h</th><th class="n">MAE@12h</th><th class="n">MAE@24h</th><th class="n">RMSE 1–24h</th><th class="n">Dir MAE (≥3 m/s)</th></tr></thead><tbody>'+
 S.map(r=>`<tr style="${{r.model==='LightGBM'?'color:var(--accent)':''}}"><td>${{r.model}} ${{r.model==='LightGBM'?'<span class="badge b-g">selected</span>':''}}</td><td class="n mono">${{r['MAE@1h']}}</td><td class="n mono">${{r['MAE@6h']}}</td><td class="n mono">${{r['MAE@12h']}}</td><td class="n mono">${{r['MAE@24h']}}</td><td class="n mono">${{r['RMSE_1-24h']}}</td><td class="n mono">${{r['dirMAE_fast_1-24h']}}</td></tr>`).join('')+'</tbody>';

const C=D.cmp,circ=(a,b)=>Math.abs(((a-b+180)%360+360)%360-180);
const mm=(f,o)=>({{mae:f.reduce((s,v,i)=>s+Math.abs(v-o[i]),0)/f.length,rmse:Math.sqrt(f.reduce((s,v,i)=>s+(v-o[i])**2,0)/f.length)}});
const mSp=R.map(r=>r.speed),mDr=R.map(r=>r.dir);
const mA=mm(mSp,C.obs_speed),aA=mm(C.api_speed,C.obs_speed);
const mD=mDr.reduce((s,v,i)=>s+circ(v,C.obs_dir[i]),0)/24,aD=C.api_dir.reduce((s,v,i)=>s+circ(v,C.obs_dir[i]),0)/24;
$('#a-date').textContent=C.date;
const cls=(a,b)=>a<b?'b-g':'b-m';
$('#a-t').innerHTML=`<thead><tr><th>Metric</th><th class="n">ML model</th><th class="n">Forecast API</th></tr></thead><tbody>
<tr><td>Speed MAE (m/s)</td><td class="n mono">${{mA.mae.toFixed(2)}} <span class="badge ${{cls(mA.mae,aA.mae)}}">${{mA.mae<aA.mae?'closer':''}}</span></td><td class="n mono">${{aA.mae.toFixed(2)}} <span class="badge ${{cls(aA.mae,mA.mae)}}">${{aA.mae<mA.mae?'closer':''}}</span></td></tr>
<tr><td>Speed RMSE (m/s)</td><td class="n mono">${{mA.rmse.toFixed(2)}}</td><td class="n mono">${{aA.rmse.toFixed(2)}}</td></tr>
<tr><td>Direction circular MAE (°)</td><td class="n mono">${{mD.toFixed(1)}} <span class="badge ${{cls(mD,aD)}}">${{mD<aD?'closer':''}}</span></td><td class="n mono">${{aD.toFixed(1)}} <span class="badge ${{cls(aD,mD)}}">${{aD<mD?'closer':''}}</span></td></tr></tbody>`;
window._acc=()=>chart($('#a-speed'),{{xs,series:[{{name:'observed',y:C.obs_speed,color:cssv('--text')}},{{name:'ML model',y:mSp,color:cssv('--accent'),marks:true}},{{name:'Forecast API',y:C.api_speed,color:cssv('--warn'),dash:true}}],unit:' m/s',ymin:0}});
$('#a-d').innerHTML='<thead><tr><th>Local</th><th class="n">Observed m/s</th><th class="n">Model m/s</th><th class="n">API m/s</th><th class="n">Model err</th><th class="n">API err</th><th class="n">Obs dir °</th><th class="n">Model dir err°</th><th class="n">API dir err°</th></tr></thead><tbody>'+
 R.map((r,i)=>`<tr><td class="mono">${{r.t}}</td><td class="n mono">${{C.obs_speed[i].toFixed(2)}}</td><td class="n mono">${{r.speed.toFixed(2)}}</td><td class="n mono">${{C.api_speed[i].toFixed(2)}}</td><td class="n mono">${{(r.speed-C.obs_speed[i]).toFixed(2)}}</td><td class="n mono">${{(C.api_speed[i]-C.obs_speed[i]).toFixed(2)}}</td><td class="n mono">${{C.obs_dir[i]}}</td><td class="n mono">${{circ(r.dir,C.obs_dir[i]).toFixed(0)}}</td><td class="n mono">${{circ(C.api_dir[i],C.obs_dir[i]).toFixed(0)}}</td></tr>`).join('')+'</tbody>';
const _d=window.draw;window.draw=function(){{_d();window._acc()}};
draw();
</script></body></html>"""

# ------------------------------------------------------------------ site setup
setup = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WindKraft Site Setup (design template)</title><style>{CSS}
.map{{height:340px;border-radius:12px;position:relative;overflow:hidden;border:1px solid var(--border);
background:linear-gradient(var(--grid) 1px,transparent 1px) 0 0/48px 48px,linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/48px 48px,var(--bg)}}
.map .pin{{position:absolute;left:52%;top:46%;width:16px;height:16px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px var(--glow),0 0 24px var(--accent)}}
.map .ring{{position:absolute;left:calc(52% - 40px);top:calc(46% - 40px);width:96px;height:96px;border-radius:50%;border:1px dashed var(--accent);opacity:.5}}
.map .tag{{position:absolute;left:calc(52% + 24px);top:calc(46% - 8px);font-size:12px;background:var(--surface);border:1px solid var(--border);padding:4px 10px;border-radius:8px}}
.map small{{position:absolute;left:12px;bottom:10px;color:var(--muted);font-size:11px}}
.steps{{display:grid;gap:10px}}.step{{display:flex;gap:12px;align-items:center;color:var(--muted)}}
.step b{{width:22px;height:22px;border-radius:50%;border:1px solid var(--border);display:grid;place-items:center;font-size:11px;font-weight:500}}
.step.done{{color:var(--text)}}.step.done b{{background:var(--good);border-color:transparent;color:#04121a}}
.step.now{{color:var(--text)}}.step.now b{{border-color:var(--accent);box-shadow:0 0 0 3px var(--glow)}}
.bar{{height:6px;background:var(--grid);border-radius:99px;overflow:hidden;margin:14px 0 6px}}.bar i{{display:block;height:100%;width:46%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:99px}}
</style></head><body><div class="wrap">{TOP('setup')}
<h2>Site</h2>
<div class="grid g2">
 <div class="card"><h3>Select turbine location</h3><div class="sub">Click the map or type coordinates</div>
  <div class="map"><div class="ring"></div><div class="pin"></div><div class="tag mono">23.0225, 72.5714</div><small>OpenStreetMap tiles in the real app (react-leaflet)</small></div></div>
 <div class="card"><div class="grid" style="gap:14px">
  <div><label>Latitude</label><input class="mono" value="23.0225"></div><div><label>Longitude</label><input class="mono" value="72.5714"></div>
  <div><label>Turbine (NREL)</label><select><option>2023 NREL Bespoke 3.3 MW · 148 m rotor · hub 100 m</option><option>BAR HighSP 5.0 MW · hub 100 m</option><option>IEC Class 3 composite 2 MW · hub 100 m</option></select></div>
  <div><label>Current nacelle heading (optional)</label><input class="mono" placeholder="degrees"></div>
  <button class="primary">Run forecast</button>
  <p class="note" style="margin:0">First run downloads 3 years of data and trains the model. Later refreshes take seconds.</p></div></div>
</div>
<h2>Job progress</h2>
<div class="grid g22">
 <div class="card"><h3>Training model for this site</h3><div class="sub mono">job 7f3a · running · 46%</div><div class="bar"><i></i></div>
  <div class="steps" style="margin-top:16px">
   <div class="step done"><b>✓</b>Download historical data</div><div class="step done"><b>✓</b>Validate &amp; clean</div>
   <div class="step done"><b>✓</b>Baselines</div><div class="step now"><b>4</b>Tune SARIMAX / LightGBM</div>
   <div class="step"><b>5</b>Rolling backtest</div><div class="step"><b>6</b>Select model</div><div class="step"><b>7</b>Generate 24 h forecast</div></div></div>
 <div class="card"><h3>Empty state</h3><div class="sub">before any forecast exists</div>
  <div style="display:grid;place-items:center;height:210px;text-align:center;color:var(--muted)">
   <div><svg viewBox="0 0 80 80" width="72" style="margin:auto;opacity:.8"><circle cx="40" cy="40" r="30" fill="none" stroke="var(--border)"/><path d="M40 40l-4-24h8z" fill="var(--accent)"/><path d="M40 40l21 12-4 6zM40 40L19 52l4 6z" fill="var(--accent)" opacity=".5"/><circle cx="40" cy="40" r="3" fill="var(--accent)"/></svg>
   <p style="margin-top:12px">No forecast yet.<br>Enter a location and run a forecast.</p></div></div></div>
</div>
<footer>Template only: no interactions are wired.</footer></div>
<script>{JS_LIB}$('#origin').textContent='no forecast yet';</script></body></html>"""

(out / "dashboard.html").write_text(dash, encoding="utf-8")
(out / "site-setup.html").write_text(setup, encoding="utf-8")
print("written")
