const $ = id => document.getElementById(id);
const altitudeSelect = $("altitudeSelect"), forecastSelect = $("forecastSelect"), refreshWind = $("refreshWind");
const windFrame = $("windFrame"), loading = $("windLoading"), levelLabel = $("levelLabel"), mapSummary = $("mapSummary");

const LEVEL_LABELS={surface:"Surface wind","850h":"850 hPa · approximately 5,000 ft","700h":"700 hPa · approximately 10,000 ft","600h":"600 hPa · approximately 14,000 ft","500h":"500 hPa · approximately 18,000 ft","400h":"400 hPa · approximately 24,000 ft","300h":"300 hPa · approximately 30,000 ft","250h":"250 hPa · approximately 34,000 ft","200h":"200 hPa · approximately 39,000 ft","150h":"150 hPa · approximately 44,000 ft","100h":"100 hPa · approximately 52,000 ft"};
const ALT_TEXT={surface:"Surface","850h":"5,000 ft","700h":"10,000 ft","600h":"14,000 ft","500h":"18,000 ft","400h":"24,000 ft","300h":"30,000 ft","250h":"34,000 ft","200h":"39,000 ft","150h":"44,000 ft","100h":"52,000 ft"};

function updateClock(){ $("utcClock").textContent=new Date().toISOString().slice(11,19); }
setInterval(updateClock,1000); updateClock();

function buildWindyUrl(){const p=new URLSearchParams({lat:"30.5",lon:"42.0",detailLat:"31.8",detailLon:"35.2",zoom:"4",level:altitudeSelect.value,overlay:"wind",product:"ecmwf",menu:"true",message:"true",marker:"true",calendar:"now",pressure:"true",type:"map",location:"coordinates",detail:"true",metricWind:"kt",metricTemp:"°C",radarRange:"-1",forecast:String(Number(forecastSelect.value||0))});return `https://embed.windy.com/embed2.html?${p}`;}
function weatherText(){return `${ALT_TEXT[altitudeSelect.value]||altitudeSelect.value} · ${forecastSelect.value==="0"?"Now":`+${forecastSelect.value} h`}`;}
function loadWindMap(){loading.classList.remove("hidden");refreshWind.disabled=true;levelLabel.textContent=LEVEL_LABELS[altitudeSelect.value]||altitudeSelect.value;mapSummary.textContent=forecastSelect.value==="0"?"Current model time":`Forecast +${forecastSelect.value} hours`;$("routeWeatherLayer").textContent=weatherText();$("summaryWeather").textContent=weatherText();windFrame.src=buildWindyUrl();}
windFrame.addEventListener("load",()=>{loading.classList.add("hidden");refreshWind.disabled=false;});
setTimeout(()=>{loading.classList.add("hidden");refreshWind.disabled=false;},12000);
refreshWind.addEventListener("click",loadWindMap);altitudeSelect.addEventListener("change",loadWindMap);forecastSelect.addEventListener("change",loadWindMap);

function openTab(name){document.querySelectorAll(".tab-button").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));$(`${name}Tab`).classList.add("active");if(name==="planner"&&routeMap)setTimeout(()=>routeMap.invalidateSize(),80);}
document.querySelectorAll(".tab-button").forEach(b=>b.addEventListener("click",()=>openTab(b.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach(b=>b.addEventListener("click",()=>openTab(b.dataset.openTab)));
$("openWeatherView").addEventListener("click",()=>openTab("weather"));

let routeMap, startMarker, endMarker, routeLine, routeArrow, clickMode=null;
function initPlanner(){
  routeMap=L.map("routeMap",{zoomControl:true,minZoom:3,maxZoom:12}).setView([30.5,42],4);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",{maxZoom:16,attribution:"Tiles © Esri"}).addTo(routeMap);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",{maxZoom:16,attribution:"Labels © Esri",pane:"overlayPane"}).addTo(routeMap);
  routeMap.on("click",e=>{if(!clickMode)return;setPoint(clickMode,e.latlng.lat,e.latlng.lng);clickMode=null;document.querySelectorAll(".map-mode").forEach(b=>b.classList.remove("active"));$("mapHint").textContent="Point saved. Select another point or calculate the route.";});
  routeMap.on("contextmenu",e=>{L.DomEvent.preventDefault(e);clearRoute();$("mapHint").textContent="Route cleared. Select a new start point.";});
  restoreRoute();
}
function markerIcon(color){return L.divIcon({className:"route-pin",html:`<span style="display:block;width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,.5)"></span>`,iconSize:[18,18],iconAnchor:[9,9]});}
function setPoint(type,lat,lon){lat=Number(lat);lon=Number(lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180){setStatus("Invalid coordinates.",true);return false;}$(type+"Lat").value=lat.toFixed(5);$(type+"Lon").value=lon.toFixed(5);if(type==="start"){if(startMarker)startMarker.setLatLng([lat,lon]);else startMarker=L.marker([lat,lon],{draggable:true,icon:markerIcon("#43e6aa")}).addTo(routeMap).bindTooltip("Start");startMarker.off("dragend").on("dragend",e=>setPoint("start",e.target.getLatLng().lat,e.target.getLatLng().lng));}else{if(endMarker)endMarker.setLatLng([lat,lon]);else endMarker=L.marker([lat,lon],{draggable:true,icon:markerIcon("#ffb45a")}).addTo(routeMap).bindTooltip("Destination");endMarker.off("dragend").on("dragend",e=>setPoint("end",e.target.getLatLng().lat,e.target.getLatLng().lng));}saveRoute();drawRoute(false);return true;}
function readPoint(type){return {lat:Number($(type+"Lat").value),lon:Number($(type+"Lon").value)};}
function validPoint(p){return Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180;}
function rad(v){return v*Math.PI/180;}function deg(v){return v*180/Math.PI;}
function routeMetrics(a,b){const Rnm=3440.065,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),la1=rad(a.lat),la2=rad(b.lat);const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;const dist=Rnm*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));const y=Math.sin(dLon)*Math.cos(la2),x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);const bearing=(deg(Math.atan2(y,x))+360)%360;return{dist,bearing};}
function formatTime(hours){if(!Number.isFinite(hours)||hours<=0)return"—";const total=Math.round(hours*60),h=Math.floor(total/60),m=total%60;return `${h} h ${String(m).padStart(2,"0")} min`;}
function drawRoute(fit=true){
  const a=readPoint("start"),b=readPoint("end");if(!validPoint(a)||!validPoint(b))return false;
  if(routeLine)routeLine.setLatLngs([[a.lat,a.lon],[b.lat,b.lon]]);else routeLine=L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{color:"#39d3ff",weight:4,opacity:.95,dashArray:"10 8"}).addTo(routeMap);
  const m=routeMetrics(a,b),speed=Number($("speedKt").value),distanceKm=m.dist*1.852,reciprocal=(m.bearing+180)%360;
  const mid=[(a.lat+b.lat)/2,(a.lon+b.lon)/2];
  if(routeArrow)routeMap.removeLayer(routeArrow);
  routeArrow=L.marker(mid,{interactive:false,icon:L.divIcon({className:"route-arrow-icon",html:`<div class="route-arrow" style="transform:rotate(${m.bearing}deg)">▲</div>`,iconSize:[30,30],iconAnchor:[15,15]})}).addTo(routeMap);
  if(fit)routeMap.fitBounds(routeLine.getBounds().pad(.3));
  $("distanceNm").textContent=`${m.dist.toFixed(1)} NM · ${distanceKm.toFixed(1)} km`;
  $("bearingDeg").textContent=`${m.bearing.toFixed(0).padStart(3,"0")}°T`;
  $("reciprocalDeg").textContent=`${reciprocal.toFixed(0).padStart(3,"0")}°T`;
  $("estimatedTime").textContent=formatTime(m.dist/speed);
  $("summaryRoute").textContent=`${m.dist.toFixed(1)} NM · ${distanceKm.toFixed(1)} km · ${m.bearing.toFixed(0).padStart(3,"0")}°T`;
  $("summaryRouteDetail").textContent=`Reciprocal ${reciprocal.toFixed(0).padStart(3,"0")}°T · Still-air estimate: ${formatTime(m.dist/speed)} at ${speed||"—"} kt.`;
  setStatus("Route calculated.");saveRoute();return true;
}
function setStatus(text,error=false){$("plannerStatus").textContent=text;$("plannerStatus").style.color=error?"#ff9d9d":"";}
function saveRoute(){localStorage.setItem("haniaion-v8-route",JSON.stringify({start:readPoint("start"),end:readPoint("end"),speed:$("speedKt").value}));}
function restoreRoute(){try{const d=JSON.parse(localStorage.getItem("haniaion-v8-route")||"null");if(!d)return;if(validPoint(d.start))setPoint("start",d.start.lat,d.start.lon);if(validPoint(d.end))setPoint("end",d.end.lat,d.end.lon);if(d.speed)$("speedKt").value=d.speed;drawRoute(true);}catch(_){}}
function clearRoute(){[startMarker,endMarker,routeLine,routeArrow].forEach(x=>x&&routeMap.removeLayer(x));startMarker=endMarker=routeLine=routeArrow=null;["startLat","startLon","endLat","endLon"].forEach(id=>$(id).value="");$("distanceNm").textContent=$("bearingDeg").textContent=$("reciprocalDeg").textContent=$("estimatedTime").textContent="—";$("summaryRoute").textContent="No route selected";$("summaryRouteDetail").textContent="Set start and destination points to create a summary.";localStorage.removeItem("haniaion-v8-route");setStatus("Route cleared.");routeMap.setView([30.5,42],4);}
document.querySelectorAll(".map-mode").forEach(b=>b.addEventListener("click",()=>{clickMode=b.dataset.mode;document.querySelectorAll(".map-mode").forEach(x=>x.classList.toggle("active",x===b));$("mapHint").textContent=`Click the map to set the ${clickMode}.`;openTab("planner");}));
$("calculateRoute").addEventListener("click",()=>{const a=readPoint("start"),b=readPoint("end");if(!validPoint(a)||!validPoint(b)){setStatus("Enter valid start and destination coordinates.",true);return;}setPoint("start",a.lat,a.lon);setPoint("end",b.lat,b.lon);drawRoute(true);});
$("clearRoute").addEventListener("click",clearRoute);$("speedKt").addEventListener("change",()=>drawRoute(false));

initPlanner();loadWindMap();
