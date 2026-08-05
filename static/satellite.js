(() => {
  const sats = [
    {name:'Sentinel-2B',type:'optical',operator:'ESA',alt:786,status:'visible',minutes:6,inc:98,phase:0.3},
    {name:'Landsat 9',type:'optical',operator:'NASA / USGS',alt:705,status:'visible',minutes:3,inc:98.2,phase:1.1},
    {name:'ICEYE-X18',type:'sar',operator:'ICEYE',alt:570,status:'visible',minutes:8,inc:97.7,phase:2.1},
    {name:'Capella-11',type:'sar',operator:'Capella Space',alt:525,status:'visible',minutes:4,inc:53,phase:2.8},
    {name:'Terra',type:'science',operator:'NASA',alt:705,status:'visible',minutes:11,inc:98.4,phase:3.4},
    {name:'Aqua',type:'science',operator:'NASA',alt:705,status:'visible',minutes:9,inc:98.2,phase:4.1},
    {name:'PlanetScope-17',type:'optical',operator:'Planet',alt:475,status:'visible',minutes:5,inc:97.3,phase:4.8},
    {name:'WorldView-3',type:'optical',operator:'Maxar',alt:617,status:'visible',minutes:7,inc:98,phase:5.4},
    {name:'Sentinel-1C',type:'sar',operator:'ESA',alt:693,status:'near',minutes:14,inc:98.2,phase:0.8},
    {name:'Cartosat-3',type:'optical',operator:'ISRO',alt:509,status:'near',minutes:18,inc:97.5,phase:2.5},
    {name:'RADARSAT-2',type:'sar',operator:'MDA',alt:798,status:'near',minutes:22,inc:98.6,phase:3.8},
    {name:'PRISMA',type:'science',operator:'ASI',alt:615,status:'away',minutes:48,inc:97.8,phase:5.8}
  ];
  const colors={visible:0x46f0a5,near:0xffd166,away:0x66768b};
  const labels={optical:'צילום אופטי',sar:'מכ״ם SAR',science:'מדעי'};
  const list=document.getElementById('satelliteList');
  let activeFilter='all';
  function renderList(){list.innerHTML='';sats.filter(s=>activeFilter==='all'||activeFilter===s.status||activeFilter===s.type).forEach(s=>{const b=document.createElement('button');b.className='sat-item';b.innerHTML=`<span class="sat-status" style="background:#${colors[s.status].toString(16).padStart(6,'0')}"></span><span><strong>${s.name}</strong><small>${labels[s.type]} · ${s.operator}</small></span><time>${s.status==='visible'?'יוצא בעוד':s.status==='near'?'כניסה בעוד':'מעבר בעוד'} ${s.minutes} דק׳</time>`;b.onclick=()=>openModal(s);list.appendChild(b);});}
  document.querySelectorAll('.filter').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));btn.classList.add('active');activeFilter=btn.dataset.filter;renderList();});
  const modal=document.getElementById('satelliteModal');
  function openModal(s){document.getElementById('modalType').textContent=labels[s.type].toUpperCase();document.getElementById('modalName').textContent=s.name;document.getElementById('modalOperator').textContent=s.operator;document.getElementById('modalAltitude').textContent=`${s.alt} ק״מ`;document.getElementById('modalStatus').textContent=s.status==='visible'?'בטווח':s.status==='near'?'מתקרב':'מחוץ לטווח';document.getElementById('modalExit').textContent=`${s.status==='visible'?'עוד':'בעוד'} ${s.minutes} דקות`;modal.classList.remove('hidden');}
  modal.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>modal.classList.add('hidden'));
  renderList();
  document.getElementById('timeline').innerHTML=sats.slice(0,8).map((s,i)=>`<div class="timeline-row"><div class="timeline-label"><strong>${s.name}</strong><small>${labels[s.type]}</small></div><div class="timeline-track"><span class="timeline-pass" style="right:${Math.min(82,i*9+2)}%;width:${10+(i%3)*4}%"></span></div><div class="timeline-time">+${i*8+2} min</div></div>`).join('');
  setInterval(()=>{document.getElementById('utcClock').textContent=new Date().toISOString().slice(11,19)},1000);

  if(!window.THREE){document.getElementById('globe').innerHTML='<p style="padding:30px">לא ניתן לטעון את מנוע התלת־ממד.</p>';return;}
  const host=document.getElementById('globe'),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,100),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.appendChild(renderer.domElement);camera.position.set(0.2,1.15,4.2);
  scene.add(new THREE.AmbientLight(0x7db8ff,1.15));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(5,3,5);scene.add(sun);
  const globeGroup=new THREE.Group();scene.add(globeGroup);
  const earth=new THREE.Mesh(new THREE.SphereGeometry(1.25,64,64),new THREE.MeshPhongMaterial({color:0x0d4f7c,emissive:0x03182a,shininess:18,transparent:true,opacity:.98}));globeGroup.add(earth);
  const grid=new THREE.Mesh(new THREE.SphereGeometry(1.257,32,20),new THREE.MeshBasicMaterial({color:0x55bfe8,wireframe:true,transparent:true,opacity:.075}));globeGroup.add(grid);
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.31,64,64),new THREE.MeshBasicMaterial({color:0x43d9ff,transparent:true,opacity:.07,side:THREE.BackSide}));globeGroup.add(atmosphere);
  function ll(lat,lon,r=1.27){const p=(90-lat)*Math.PI/180,t=(lon+180)*Math.PI/180;return new THREE.Vector3(-r*Math.sin(p)*Math.cos(t),r*Math.cos(p),r*Math.sin(p)*Math.sin(t));}
  const israel=ll(31.5,34.8);const marker=new THREE.Mesh(new THREE.SphereGeometry(.035,16,16),new THREE.MeshBasicMaterial({color:0x43d9ff}));marker.position.copy(israel);globeGroup.add(marker);const ring=new THREE.Mesh(new THREE.RingGeometry(.055,.085,32),new THREE.MeshBasicMaterial({color:0x43d9ff,transparent:true,opacity:.75,side:THREE.DoubleSide}));ring.position.copy(israel.clone().multiplyScalar(1.008));ring.lookAt(israel.clone().multiplyScalar(2));globeGroup.add(ring);
  const satMeshes=[];sats.forEach((s,idx)=>{const orbitR=1.48+s.alt/5000;const curve=[];for(let j=0;j<120;j++){const a=j/119*Math.PI*2;const x=orbitR*Math.cos(a),z=orbitR*Math.sin(a),y=Math.sin(a)*Math.sin(s.inc*Math.PI/180)*orbitR*.65;curve.push(new THREE.Vector3(x,y,z));}const geo=new THREE.BufferGeometry().setFromPoints(curve),line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:colors[s.status],transparent:true,opacity:s.status==='away'?.12:.3}));line.rotation.y=s.phase;line.rotation.z=(idx%4)*.18;globeGroup.add(line);const mesh=new THREE.Mesh(new THREE.SphereGeometry(.035,12,12),new THREE.MeshBasicMaterial({color:colors[s.status]}));mesh.userData={sat:s,orbitR,phase:s.phase,speed:.12+idx*.008,tilt:line.rotation.z};globeGroup.add(mesh);satMeshes.push(mesh);});
  const starsGeo=new THREE.BufferGeometry(),starPos=[];for(let i=0;i<800;i++){const r=12+Math.random()*18,a=Math.random()*Math.PI*2,b=Math.acos(2*Math.random()-1);starPos.push(r*Math.sin(b)*Math.cos(a),r*Math.cos(b),r*Math.sin(b)*Math.sin(a));}starsGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPos,3));scene.add(new THREE.Points(starsGeo,new THREE.PointsMaterial({color:0x9bc7ff,size:.025,transparent:true,opacity:.65})));
  let dragging=false,lastX=0,lastY=0,targetX=.15,targetY=-.55;host.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY});addEventListener('pointerup',()=>dragging=false);addEventListener('pointermove',e=>{if(!dragging)return;targetY+=(e.clientX-lastX)*.006;targetX+=(e.clientY-lastY)*.006;targetX=Math.max(-1.2,Math.min(1.2,targetX));lastX=e.clientX;lastY=e.clientY});host.addEventListener('wheel',e=>{e.preventDefault();camera.position.z=Math.max(2.7,Math.min(7,camera.position.z+e.deltaY*.003))},{passive:false});document.getElementById('resetCamera').onclick=()=>{targetX=.15;targetY=-.55;camera.position.z=4.2};
  const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();host.addEventListener('click',e=>{const r=host.getBoundingClientRect();mouse.x=(e.clientX-r.left)/r.width*2-1;mouse.y=-((e.clientY-r.top)/r.height*2-1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects(satMeshes)[0];if(hit)openModal(hit.object.userData.sat)});
  function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
  const clock=new THREE.Clock();function animate(){requestAnimationFrame(animate);const t=clock.getElapsedTime();globeGroup.rotation.x+=(targetX-globeGroup.rotation.x)*.06;globeGroup.rotation.y+=(targetY-globeGroup.rotation.y)*.06;satMeshes.forEach((m,i)=>{const u=t*m.userData.speed+m.userData.phase;const r=m.userData.orbitR;m.position.set(r*Math.cos(u),Math.sin(u)*Math.sin(sats[i].inc*Math.PI/180)*r*.65,r*Math.sin(u));m.position.applyAxisAngle(new THREE.Vector3(0,1,0),m.userData.phase);});ring.scale.setScalar(1+Math.sin(t*3)*.18);renderer.render(scene,camera)}animate();
})();
