const altitudeSelect = document.getElementById("altitudeSelect");
const forecastSelect = document.getElementById("forecastSelect");
const refreshWind = document.getElementById("refreshWind");
const loading = document.getElementById("windLoading");
const validTime = document.getElementById("validTime");
const levelLabel = document.getElementById("levelLabel");
const mapSummary = document.getElementById("mapSummary");
const selectedPoint = document.getElementById("selectedPoint");
const animationToggle = document.getElementById("animationToggle");

const REGION_BOUNDS = L.latLngBounds([[16, 20], [42, 64]]);
const map = L.map("windMap", {
  zoomControl: true,
  minZoom: 3,
  maxZoom: 9,
  maxBounds: [[5, 5], [55, 80]],
  maxBoundsViscosity: 0.75,
  preferCanvas: true,
});
map.fitBounds(REGION_BOUNDS, { padding: [8, 8] });

L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 16,
  attribution: "Tiles &copy; Esri",
}).addTo(map);
map.createPane("englishLabels");
map.getPane("englishLabels").style.zIndex = 520;
map.getPane("englishLabels").style.pointerEvents = "none";
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
  pane: "englishLabels",
  maxZoom: 16,
  attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS",
}).addTo(map);

const mapContainer = map.getContainer();
function makeCanvas(className) {
  const element = document.createElement("canvas");
  element.className = className;
  mapContainer.appendChild(element);
  return element;
}
const fieldCanvas = makeCanvas("wind-field-canvas");
const flowCanvas = makeCanvas("wind-particle-canvas");
const fieldCtx = fieldCanvas.getContext("2d");
const flowCtx = flowCanvas.getContext("2d");

let windData = null;
let grid = null;
let particles = [];
let animationEnabled = true;
let lastFrame = performance.now();

function compass(direction) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(direction / 45) % 8];
}
function formatUtc(value) {
  if (!value) return "Model time unavailable";
  const date = new Date(`${value}:00Z`);
  return `${date.toLocaleString(undefined, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`;
}
function colorForSpeed(speed, alpha = 1) {
  if (speed < 10) return `rgba(40,210,255,${alpha})`;
  if (speed < 20) return `rgba(55,235,170,${alpha})`;
  if (speed < 35) return `rgba(255,220,70,${alpha})`;
  if (speed < 50) return `rgba(255,135,55,${alpha})`;
  if (speed < 70) return `rgba(255,65,95,${alpha})`;
  return `rgba(210,75,255,${alpha})`;
}
function createGrid(data) {
  const byKey = new Map();
  data.points.forEach((p) => byKey.set(`${p.latitude.toFixed(2)}:${p.longitude.toFixed(2)}`, p));
  return { byKey, latMin:data.region.lat_min, latMax:data.region.lat_max, lonMin:data.region.lon_min, lonMax:data.region.lon_max, latStep:data.region.lat_step, lonStep:data.region.lon_step };
}
function lookupPoint(lat, lon) {
  if (!grid || lat < grid.latMin || lat > grid.latMax || lon < grid.lonMin || lon > grid.lonMax) return null;
  const lat0 = Math.floor((lat-grid.latMin)/grid.latStep)*grid.latStep+grid.latMin;
  const lon0 = Math.floor((lon-grid.lonMin)/grid.lonStep)*grid.lonStep+grid.lonMin;
  const lat1 = Math.min(lat0+grid.latStep, grid.latMax), lon1 = Math.min(lon0+grid.lonStep, grid.lonMax);
  const get=(la,lo)=>grid.byKey.get(`${la.toFixed(2)}:${lo.toFixed(2)}`);
  const pts=[get(lat0,lon0),get(lat0,lon1),get(lat1,lon0),get(lat1,lon1)];
  if (pts.some((p)=>!p)) return pts.find(Boolean) || null;
  const tx=lon1===lon0?0:(lon-lon0)/(lon1-lon0), ty=lat1===lat0?0:(lat-lat0)/(lat1-lat0);
  const comp=pts.map((p)=>{ const toward=(p.direction_degrees+180)*Math.PI/180; return {u:Math.sin(toward)*p.speed_knots,v:Math.cos(toward)*p.speed_knots}; });
  const blend=(a,b,c,d)=>a*(1-tx)*(1-ty)+b*tx*(1-ty)+c*(1-tx)*ty+d*tx*ty;
  const u=blend(comp[0].u,comp[1].u,comp[2].u,comp[3].u), v=blend(comp[0].v,comp[1].v,comp[2].v,comp[3].v);
  const speed=Math.hypot(u,v), toward=(Math.atan2(u,v)*180/Math.PI+360)%360;
  return {speed_knots:speed,direction_degrees:(toward+180)%360,u,v};
}
function resizeCanvas(canvas, ctx) {
  const size=map.getSize(), ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(size.x*ratio); canvas.height=Math.round(size.y*ratio);
  canvas.style.width=`${size.x}px`; canvas.style.height=`${size.y}px`;
  ctx.setTransform(ratio,0,0,ratio,0,0);
}
function resizeAll() {
  resizeCanvas(fieldCanvas,fieldCtx); resizeCanvas(flowCanvas,flowCtx);
  drawField(); resetParticles();
}
function drawArrow(ctx,x,y,length,fromDirection,color) {
  const toward=(fromDirection+180)*Math.PI/180;
  const dx=Math.sin(toward)*length, dy=-Math.cos(toward)*length;
  const x2=x+dx,y2=y+dy, angle=Math.atan2(dy,dx), head=4.5;
  ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(x-dx*.35,y-dy*.35); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(x2-head*Math.cos(angle-Math.PI/6),y2-head*Math.sin(angle-Math.PI/6)); ctx.lineTo(x2-head*Math.cos(angle+Math.PI/6),y2-head*Math.sin(angle+Math.PI/6)); ctx.closePath(); ctx.fill();
}
function drawField() {
  const w=fieldCanvas.clientWidth,h=fieldCanvas.clientHeight;
  fieldCtx.clearRect(0,0,w,h);
  if (!windData?.points?.length) return;
  fieldCtx.save(); fieldCtx.globalCompositeOperation="source-over";
  for (const p of windData.points) {
    const center=map.latLngToContainerPoint([p.latitude,p.longitude]);
    const east=map.latLngToContainerPoint([p.latitude,p.longitude+windData.region.lon_step]);
    const north=map.latLngToContainerPoint([p.latitude+windData.region.lat_step,p.longitude]);
    const cellW=Math.max(22,Math.abs(east.x-center.x)+3), cellH=Math.max(22,Math.abs(north.y-center.y)+3);
    const grad=fieldCtx.createRadialGradient(center.x,center.y,2,center.x,center.y,Math.max(cellW,cellH)*.75);
    grad.addColorStop(0,colorForSpeed(p.speed_knots,.46)); grad.addColorStop(1,colorForSpeed(p.speed_knots,.04));
    fieldCtx.fillStyle=grad; fieldCtx.fillRect(center.x-cellW*.6,center.y-cellH*.6,cellW*1.2,cellH*1.2);
  }
  fieldCtx.globalCompositeOperation="screen";
  windData.points.forEach((p,i)=>{
    if (map.getZoom()<=4 && i%2) return;
    const pt=map.latLngToContainerPoint([p.latitude,p.longitude]);
    if(pt.x<-20||pt.y<-20||pt.x>w+20||pt.y>h+20)return;
    drawArrow(fieldCtx,pt.x,pt.y,8+Math.min(14,p.speed_knots*.16),p.direction_degrees,colorForSpeed(p.speed_knots,.96));
  });
  fieldCtx.restore();
}
function randomLatLngInView() {
  const b=map.getBounds();
  const south=Math.max(b.getSouth(),grid?.latMin??16), north=Math.min(b.getNorth(),grid?.latMax??42), west=Math.max(b.getWest(),grid?.lonMin??20), east=Math.min(b.getEast(),grid?.lonMax??64);
  return L.latLng(south+Math.random()*Math.max(.01,north-south),west+Math.random()*Math.max(.01,east-west));
}
function resetParticle(p={}) { const ll=randomLatLngInView(); p.lat=ll.lat;p.lon=ll.lng;p.age=Math.random()*70;p.maxAge=55+Math.random()*80;p.trail=[];return p; }
function resetParticles() {
  const area=map.getSize().x*map.getSize().y, count=Math.max(350,Math.min(window.innerWidth<700?850:1600,Math.round(area/520)));
  particles=Array.from({length:count},()=>resetParticle({}));
  flowCtx.clearRect(0,0,flowCanvas.clientWidth,flowCanvas.clientHeight);
}
function animate(now) {
  requestAnimationFrame(animate);
  const w=flowCanvas.clientWidth,h=flowCanvas.clientHeight;
  flowCtx.clearRect(0,0,w,h);
  if(!animationEnabled||!grid)return;
  const dt=Math.min((now-lastFrame)/16.67,2);lastFrame=now;
  const zoomScale=Math.pow(1.35,map.getZoom()-4);
  for(const p of particles){
    const wind=lookupPoint(p.lat,p.lon);
    if(!wind||p.age++>p.maxAge){resetParticle(p);continue;}
    const point=map.latLngToContainerPoint([p.lat,p.lon]);
    if(point.x<-30||point.y<-30||point.x>w+30||point.y>h+30){resetParticle(p);continue;}
    p.trail.push([point.x,point.y]); if(p.trail.length>9)p.trail.shift();
    if(p.trail.length>1){
      for(let i=1;i<p.trail.length;i++){
        flowCtx.beginPath(); flowCtx.lineWidth=.7+i*.11; flowCtx.strokeStyle=colorForSpeed(wind.speed_knots,.08+i*.085);
        flowCtx.moveTo(...p.trail[i-1]);flowCtx.lineTo(...p.trail[i]);flowCtx.stroke();
      }
    }
    const factor=.0007*dt/zoomScale; p.lat+=wind.v*factor; p.lon+=wind.u*factor/Math.max(Math.cos(p.lat*Math.PI/180),.35);
  }
}
function showPoint(latlng) {
  const wind=lookupPoint(latlng.lat,latlng.lng); if(!wind||!windData)return;
  const direction=Math.round(wind.direction_degrees), text=`${wind.speed_knots.toFixed(1)} kt · ${String(direction).padStart(3,"0")}° ${compass(direction)}`;
  selectedPoint.textContent=`${latlng.lat.toFixed(3)}°, ${latlng.lng.toFixed(3)}° — ${text}`;
  L.popup({className:"wind-popup"}).setLatLng(latlng).setContent(`<div class="wind-popup-content"><span>Selected wind</span><strong>${wind.speed_knots.toFixed(1)} kt</strong><b>From ${String(direction).padStart(3,"0")}° (${compass(direction)})</b><small>${windData.level_label}<br>${formatUtc(windData.valid_time_utc)}</small></div>`).openOn(map);
}
async function loadWind(){
  loading.classList.remove("hidden");refreshWind.disabled=true;mapSummary.textContent="Retrieving GFS wind field…";
  try{
    const params=new URLSearchParams({altitude_ft:altitudeSelect.value,forecast_hour:forecastSelect.value});
    const response=await fetch(`/api/wind/grid?${params}`,{cache:"no-store"});const data=await response.json();
    if(!response.ok)throw new Error(data.detail||"Unable to load wind data.");if(!data.points?.length)throw new Error("The forecast returned no usable wind samples.");
    windData=data;grid=createGrid(data);levelLabel.textContent=data.level_label;validTime.textContent=formatUtc(data.valid_time_utc);
    const speeds=data.points.map(p=>p.speed_knots),min=Math.min(...speeds),max=Math.max(...speeds);
    mapSummary.textContent=`${data.points.length} samples · ${min.toFixed(0)}–${max.toFixed(0)} kt · ${data.cached?"cached":"updated"}`;
    selectedPoint.textContent="Tap anywhere on the map for exact interpolated wind.";drawField();resetParticles();
  }catch(error){mapSummary.textContent=error.message;}finally{loading.classList.add("hidden");refreshWind.disabled=false;}
}
refreshWind.addEventListener("click",loadWind);altitudeSelect.addEventListener("change",loadWind);forecastSelect.addEventListener("change",loadWind);
animationToggle.addEventListener("click",()=>{animationEnabled=!animationEnabled;animationToggle.classList.toggle("is-off",!animationEnabled);animationToggle.textContent=animationEnabled?"Pause flow":"Resume flow";if(!animationEnabled)flowCtx.clearRect(0,0,flowCanvas.clientWidth,flowCanvas.clientHeight);else resetParticles();});
map.on("click",e=>showPoint(e.latlng));map.on("moveend zoomend resize",resizeAll);window.addEventListener("resize",resizeAll);
resizeAll();requestAnimationFrame(animate);loadWind();
