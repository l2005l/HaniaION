(() => {
  const colors = { visible: 0x46f0a5, near: 0xffd166, away: 0x66768b };
  const labels = { optical: 'צילום אופטי', sar: 'מכ״ם SAR', science: 'מדעי', observation: 'תצפית משאבים' };
  const host = document.getElementById('globe');
  const list = document.getElementById('satelliteList');
  const modal = document.getElementById('satelliteModal');
  let sats = [];
  let activeFilter = 'all';
  let globeApi = null;

  const fmtTime = iso => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(iso));
  const statusText = s => s === 'visible' ? 'בטווח משוער' : s === 'near' ? 'מתקרב' : 'מחוץ לטווח';

  function openModal(s) {
    document.getElementById('modalType').textContent = (labels[s.type] || s.type).toUpperCase();
    document.getElementById('modalName').textContent = s.name;
    document.getElementById('modalOperator').textContent = `NORAD ${s.norad_id}`;
    document.getElementById('modalAltitude').textContent = `${Math.round(s.alt_km)} ק״מ`;
    document.getElementById('modalStatus').textContent = statusText(s.status);
    document.getElementById('modalExit').textContent = s.windows?.[0] ? `${fmtTime(s.windows[0].start)}–${fmtTime(s.windows[0].end)} UTC` : (s.next_entry_minutes != null ? `בעוד ${s.next_entry_minutes} דקות` : 'לא נמצא בטווח החישוב');
    document.getElementById('modalNote').textContent = `${s.mission}. מרחק נקודת הקרקע מישראל: ${Math.round(s.distance_km)} ק״מ. טווח הכיסוי הוא אומדן קטגוריאלי בלבד.`;
    modal.classList.remove('hidden');
  }
  modal.querySelectorAll('[data-close]').forEach(x => x.onclick = () => modal.classList.add('hidden'));

  function renderList() {
    const filtered = sats.filter(s => activeFilter === 'all' || activeFilter === s.status || activeFilter === s.type).slice(0, 60);
    list.innerHTML = filtered.map((s, i) => `<button class="sat-item" data-index="${sats.indexOf(s)}"><span class="sat-status" style="background:#${colors[s.status].toString(16).padStart(6,'0')}"></span><span><strong>${s.name}</strong><small>${labels[s.type] || s.type} · NORAD ${s.norad_id}</small></span><time>${s.status === 'visible' ? 'כעת' : s.next_entry_minutes != null ? `+${s.next_entry_minutes} דק׳` : '—'}</time></button>`).join('') || '<p class="empty-state">אין לוויינים במסנן זה.</p>';
    list.querySelectorAll('.sat-item').forEach(b => b.onclick = () => openModal(sats[Number(b.dataset.index)]));
  }
  document.querySelectorAll('.filter').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
    btn.classList.add('active'); activeFilter = btn.dataset.filter; renderList();
  });

  function renderTimeline() {
    const rows = sats.filter(s => s.windows?.length).slice(0, 14);
    const now = Date.now(), horizon = 90 * 60 * 1000;
    document.getElementById('timeline').innerHTML = rows.map(s => {
      const w = s.windows[0]; const start = Math.max(0, (new Date(w.start).getTime() - now) / horizon * 100);
      const width = Math.max(2, (new Date(w.end).getTime() - new Date(w.start).getTime()) / horizon * 100);
      return `<div class="timeline-row"><div class="timeline-label"><strong>${s.name}</strong><small>${labels[s.type] || s.type}</small></div><div class="timeline-track"><span class="timeline-pass" style="right:${Math.min(98,start)}%;width:${Math.min(100-start,width)}%"></span></div><div class="timeline-time">${fmtTime(w.start)}</div></div>`;
    }).join('') || '<p class="empty-state">לא נמצאו חלונות מועמדים ב־90 הדקות הקרובות.</p>';
  }

  function applyStats(data) {
    const c = data.counts;
    document.getElementById('visibleCount').textContent = c.visible;
    document.getElementById('opticalCount').textContent = c.optical;
    document.getElementById('sarCount').textContent = c.sar;
    document.getElementById('scienceCount').textContent = c.science;
    document.getElementById('nearCount').textContent = c.near;
    document.getElementById('objectCount').textContent = c.total;
    const score = Math.min(100, Math.round((c.visible / Math.max(1, c.total)) * 250));
    document.getElementById('coverageScore').textContent = `${score}%`;
    document.getElementById('coverageBar').style.width = `${score}%`;
    const gap = data.no_coverage_windows?.[0];
    document.getElementById('windowTime').textContent = gap ? `${fmtTime(gap.start)}–${fmtTime(gap.end)} UTC` : 'לא נמצא בטווח החישוב';
    document.getElementById('windowCountdown').textContent = gap ? `${Math.max(0, Math.round((new Date(gap.start)-Date.now())/60000))} דקות · משך ${gap.duration_minutes} דקות` : '—';
    document.getElementById('sourceStamp').textContent = `TLE עודכן: ${fmtTime(data.tle_fetched_at)} UTC`;
  }

  async function loadData() {
    document.getElementById('dataState').textContent = 'טוען נתוני מסלול…';
    try {
      const response = await fetch('/api/satellites/coverage?minutes=90', { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      const data = await response.json(); sats = data.objects; applyStats(data); renderList(); renderTimeline();
      document.getElementById('dataState').textContent = data.source_mode === 'live' ? 'נתוני מסלול ציבוריים פעילים' : 'מצב גיבוי — נתוני מסלול שמורים';
      if (globeApi) globeApi.setSatellites(sats); else globeApi = createGlobe(sats);
    } catch (error) {
      document.getElementById('dataState').textContent = 'טעינת הנתונים נכשלה';
      const state = document.getElementById('sourceWarning'); if (state) { state.hidden = false; state.textContent = `לא ניתן לעדכן נתונים: ${String(error.message || error)}`; }
    }
  }

  function createGlobe(initial) {
    if (!window.THREE) { host.innerHTML = '<div class="globe-error"><strong>מנוע התלת־ממד לא נטען</strong><small>הדפדפן או הרשת חסמו את Three.js.</small></div>'; return null; }
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42,1,.1,100), renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); host.innerHTML=''; host.appendChild(renderer.domElement); camera.position.set(.2,1.15,4.2);
    scene.add(new THREE.AmbientLight(0x7db8ff,1.15)); const sun = new THREE.DirectionalLight(0xffffff,2.2); sun.position.set(5,3,5); scene.add(sun);
    const group = new THREE.Group(); scene.add(group);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.25,64,64),new THREE.MeshPhongMaterial({color:0x0d4f7c,emissive:0x03182a,shininess:18})));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1.257,32,20),new THREE.MeshBasicMaterial({color:0x55bfe8,wireframe:true,transparent:true,opacity:.075})));
    const ll=(lat,lon,r=1.27)=>{const p=(90-lat)*Math.PI/180,t=(lon+180)*Math.PI/180;return new THREE.Vector3(-r*Math.sin(p)*Math.cos(t),r*Math.cos(p),r*Math.sin(p)*Math.sin(t));};
    const israel=ll(31.5,34.8), marker=new THREE.Mesh(new THREE.SphereGeometry(.04,16,16),new THREE.MeshBasicMaterial({color:0x43d9ff})); marker.position.copy(israel); group.add(marker);
    let meshes=[];
    function clearSats(){meshes.forEach(m=>group.remove(m));meshes=[];}
    function setSatellites(items){clearSats();items.slice(0,120).forEach(s=>{const m=new THREE.Mesh(new THREE.SphereGeometry(s.status==='visible'?.038:.026,10,10),new THREE.MeshBasicMaterial({color:colors[s.status]}));m.position.copy(ll(s.lat,s.lon,1.34+Math.min(.65,s.alt_km/2200)));m.userData.sat=s;group.add(m);meshes.push(m);});}
    setSatellites(initial);
    let dragging=false,lastX=0,lastY=0,targetX=.15,targetY=-.55;
    host.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY}); addEventListener('pointerup',()=>dragging=false);
    addEventListener('pointermove',e=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.006;targetX+=(e.clientY-lastY)*.006;lastX=e.clientX;lastY=e.clientY});
    host.addEventListener('wheel',e=>{e.preventDefault();camera.position.z=Math.max(2.7,Math.min(7,camera.position.z+e.deltaY*.003))},{passive:false});
    document.getElementById('resetCamera').onclick=()=>{targetX=.15;targetY=-.55;camera.position.z=4.2};
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();host.addEventListener('click',e=>{const r=host.getBoundingClientRect();mouse.x=(e.clientX-r.left)/r.width*2-1;mouse.y=-((e.clientY-r.top)/r.height*2-1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects(meshes)[0];if(hit)openModal(hit.object.userData.sat)});
    function resize(){renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
    (function animate(){requestAnimationFrame(animate);group.rotation.x+=(targetX-group.rotation.x)*.06;group.rotation.y+=(targetY-group.rotation.y)*.06;renderer.render(scene,camera)})();
    return {setSatellites};
  }

  setInterval(()=>document.getElementById('utcClock').textContent=new Date().toISOString().slice(11,19),1000);
  globeApi = createGlobe([]);
  loadData(); setInterval(loadData, 5*60*1000);
})();
