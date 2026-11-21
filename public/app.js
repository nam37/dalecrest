import { createMap } from './map.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
const names = { village: 'Village observatory', residents: 'Village residents', chronicle: 'Village chronicle' };
const kinds = { village: 'Village', work: 'Work', meal: 'Meal', social: 'Encounter', plan: 'Intention', civic: 'Affairs', build: 'Building', arrival: 'Arrival' };
const stores = { grain:'Barley', flour:'Flour', bread:'Bread', wood:'Firewood', cloth:'Linen', water:'Water', repair:'Building repairs' };
const colors = ['#946344','#68764f','#a8654c','#456d65','#827892','#7c6043','#567895','#946e46'];
let state, latest, frozen=false, selected='agnes', tab='life', route='village', rosterSignature='';
let ground=null, groundRevision=null, fetching=false, viewMode='plan', walk=null;
const map = createMap($('map'), choose);
const capacity = { grain:44, flour:34, bread:32, wood:32, cloth:12, repair:14, water:28 };

// The map only changes when the village builds something, so it is fetched apart from the snapshot.
async function loadGround(revision) {
  if (fetching || revision === groundRevision) return;
  fetching = true;
  try {
    const res = await fetch('/api/map', { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error();
    ground = await res.json(); groundRevision = revision;
    map.setMap(ground, state?.locations);
    walk?.setMap(ground);
  } catch {} finally { fetching = false; }
}
async function show(mode) {
  viewMode = mode;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('map').hidden = mode !== 'plan'; $('walk').hidden = mode !== 'walk';
  document.querySelector('.map-zoom').hidden = document.querySelector('.map-compass').hidden = mode !== 'plan';
  $('walk-caption').hidden = mode !== 'walk';
  $('map-hint').textContent = mode === 'plan' ? 'Drag to pan · click, then scroll to zoom' : 'Drag to look around · click, then scroll to move closer · click a resident to follow';
  if (mode === 'walk' && !walk) {
    $('walk-caption').textContent = 'Opening the village at eye level…';
    try {
      const { createWalk } = await import('/view3d.js');
      walk = createWalk($('walk'), choose);
      if (ground) walk.setMap(ground);
    } catch { $('walk-caption').textContent = 'This browser could not open the walking view.'; return; }
  }
  walk?.setActive(mode === 'walk');
  if (mode === 'plan') map.redraw();
  render();
}

function time(minute) {
  const hour = Math.floor(minute / 60) % 24;
  return (hour % 12 || 12) + ':' + String(minute % 60).padStart(2,'0') + (hour < 12 ? ' am' : ' pm');
}
function date(minute) { return 'Day ' + (Math.floor(minute / 1440) + 1); }

function portrait(actor) {
  const canvas = el('canvas','portrait');
  canvas.width=30; canvas.height=32; canvas.setAttribute('aria-hidden','true');
  const ctx=canvas.getContext('2d');
  const i=state.actors.findIndex(a=>a.id===actor.id);
  const cloth=colors[i % colors.length];
  const skin=['#c99873','#bb9270','#ce9d78','#bc8e6c','#bf926d','#aa7a55','#d6a77d','#c59a70'][i % 8];
  const hair=['#62503c','#65594b','#6b4733','#584d3c','#765c4a','#67492e','#524633','#795b3c'][i % 8];
  function r(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
  r(0,0,30,32,'#e3e1cd');
  for(let x=0;x<30;x+=3) r(x,24+(x%4),1,8,'#d1d3b8');
  r(3,28,24,4,cloth);r(6,25,18,6,cloth);r(10,23,10,6,cloth);r(12,21,6,4,skin);
  r(8,9,14,11,hair);r(10,7,11,4,hair);r(10,12,11,9,skin);r(12,21,7,2,skin);
  r(18,14,4,4,skin);r(19,15,1,1,'#4e4538');r(17,20,3,1,'#996e53');
  r(8,12,3,7,hair);r(11,11,6,2,hair);r(10,25,2,7,'#ddd0ad');r(18,25,2,7,'#ddd0ad');
  if (i%3===0) {r(7,9,16,3,'#bc985a');r(9,7,12,3,'#c3a467');r(11,5,8,3,'#c3a467');}
  if (i%3===1) {r(7,9,15,3,cloth);r(9,6,11,4,cloth);r(10,18,3,5,hair);}
  if (i%3===2) {r(8,9,12,4,'#dfd7bb');r(10,7,9,3,'#e9e2cb');r(7,12,4,10,'#d2c7a8');}
  return canvas;
}

function who(actor) {
  const row=el('div','profile-top'), text=el('div');
  text.append(el('h3','',actor.name),el('p','role',actor.role));
  row.append(portrait(actor),text);
  return row;
}
function block(label, ...children) {
  const div=el('div','detail-block');
  div.append(el('div','eyebrow',label),...children);
  return div;
}
function choose(id) {
  if (!state?.actors.some(a=>a.id===id)) return;
  selected=id;
  if (route!=='village') location.hash='village';
  render();
}
function renderProfile(actor) {
  const traits=el('div','trait-list');
  for(const t of actor.traits) traits.append(el('span','trait',t));
  $('profile').replaceChildren(who(actor),traits);
  const picker=$('pick-resident');
  if(picker.options.length!==state.actors.length) {
    picker.replaceChildren(...state.actors.map(a=>new Option(a.name.split(' ')[0],a.id)));
  }
  picker.value=actor.id;
  for(const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed',String(b.dataset.tab===tab));
  const detail=$('detail');
  if(tab==='data'){
    let pre=detail.querySelector('pre');
    if(!pre){pre=el('pre','raw'); pre.tabIndex=0; pre.setAttribute('aria-label','PostgreSQL JSONB record for '+actor.name); detail.replaceChildren(pre);}
    const top=pre.scrollTop;
    pre.textContent=JSON.stringify(actor,null,2); pre.scrollTop=top; return;
  }
  detail.replaceChildren();
  if(tab==='memory'){
    detail.append(block('Background',el('p','bio',actor.backstory)));
    const memories=block('Recent memories');
    for(const m of actor.memories.slice(-4).reverse()){
      const row=el('div','memory-item');
      row.append(el('time','',date(m.minute)+' · '+time(m.minute)),el('p','memory-text',m.text));
      memories.append(row);
    }
    if(!actor.memories.length)memories.append(el('p','empty','No encounters or completed work recorded yet.'));
    const bonds=Object.entries(actor.relationships).sort((a,b)=>b[1]-a[1]).slice(0,2);
    detail.append(memories,block('Closest ties',...bonds.map(([id])=>el('p','goal',state.actors.find(a=>a.id===id)?.name||id))));
    return;
  }
  const activity=actor.action;
  const at=state.locations[activity.target]?.name || activity.target;
  detail.append(block(activity.phase==='travelling'?'Walking to '+at:'At '+at,el('strong','activity',activity.label),el('p','reason',activity.reason)));
  if(actor.plan)detail.append(block(actor.plan.method==='choice'?'Model priority · '+actor.plan.focus:'Model intention',el('p','goal',actor.plan.reason)));
  detail.append(block('Desires',...(actor.desires||[]).map(d=>el('p','goal',d.label))));
  const needs=block('Current needs');
  for(const [key,val] of Object.entries(actor.needs)){
    const n=Math.round(val), row=el('div','need'), track=el('span','track'), fill=el('i');
    fill.style.width=n+'%'; track.append(fill);
    row.append(el('span','',key[0].toUpperCase()+key.slice(1)),track,el('span','num',n));
    needs.append(row);
  }
  detail.append(needs);
}
function renderAffairs() {
  const affairs=state.affairs||{works:[],talk:[]}, rows=[];
  if(affairs.moot) rows.push(el('p','affair-note','The moot meets at the hall, '+date(affairs.moot)+' at '+time(affairs.moot)+'.'));
  for(const work of affairs.works){
    const row=el('div','affair'), track=el('span','track'), fill=el('i');
    fill.style.width=Math.round(100*work.done/work.need)+'%'; track.append(fill);
    row.append(el('span','affair-title',work.title+(work.where?' · '+work.where:'')),track,el('span','num',work.done+'/'+work.need));
    rows.push(row);
  }
  for(const talk of affairs.talk){
    const row=el('div','affair talk');
    row.append(el('span','affair-title',talk.title),el('span','num',talk.voices+' of '+talk.needed+' voices'));
    rows.push(row);
  }
  if(!rows.length) rows.push(el('p','empty','Nothing is being built or argued over today.'));
  $('affairs').replaceChildren(...rows);
}
function journal(target,events,withDay=false) {
  const fragment=document.createDocumentFragment();
  for (const e of events) {
    const row=el('div','journal-row'), entry=el('p');
    entry.append(el('span','kind',kinds[e.type]||e.type),document.createTextNode(e.text));
    row.append(el('time','journal-time',(withDay?date(e.minute)+' · ':'')+time(e.minute)),entry);
    fragment.append(row);
  }
  if(!events.length)fragment.append(el('p','empty','No matching events in the latest 100 records.'));
  target.replaceChildren(fragment);
}
function roster() {
  const signature=state.actors.map(a=>[a.id,a.name,a.role,a.backstory]).join('|');
  if(signature===rosterSignature)return;
  rosterSignature=signature;
  const cards=state.actors.map(a=>{
    const card=el('article','resident-card'),btn=el('button','record-button','View record');
    btn.type='button'; btn.setAttribute('aria-label','View '+a.name+'’s record'); btn.addEventListener('click',()=>choose(a.id));
    card.append(who(a),el('p','bio',a.backstory),btn);return card;
  });
  $('roster').replaceChildren(...cards);
}
function render() {
  if(!state)return;
  const {world,actors,events,planner}=state;
  $('title').textContent=names[route];
  $('summary').textContent={village:actors.length+' residents living and working in a medieval parish.',residents:'The people, trades, and households of Dalecrest.',chronicle:'The latest 100 entries from the village records.'}[route];
  $('day').textContent=date(world.minute); $('time').textContent=time(world.minute);
  $('planner-status').textContent=planner.configured?'Planner · '+planner.model+' · '+planner.state:'Planner · local decision rules';
  if(route==='village'){
    const actor=actors.find(a=>a.id===selected)||actors[0]; selected=actor.id;
    map.update(actors,selected,state.locations);
    if(walk&&viewMode==='walk'){
      walk.update(actors,selected,world.minute);
      $('walk-caption').textContent='Following '+actor.name+' · '+actor.action.label;
    }
    renderProfile(actor);renderAffairs();
    $('map-count').textContent=actors.length+' residents';
    journal($('recent-events'),events.slice(0,4));
    $('supplies').replaceChildren(...Object.entries(stores).map(([key,name])=>{
      const row=el('div','supply'),amount=el('strong','',world.supplies[key]);
      amount.append(el('small','',' / '+(world.capacity?.[key]??capacity[key])));
      row.append(el('span','',name),amount);return row;
    }));
  }else if(route==='residents')roster();
  else journal($('all-events'),events.filter(e=>!$('event-type').value||e.type===$('event-type').value),true);
}
function navigate(){
  const key=location.hash.slice(1);
  route=Object.hasOwn(names,key)?key:'village';
  for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==route;
  for(const link of document.querySelectorAll('nav a')){
    if(link.hash==='#'+route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  render();
}
async function refresh(){
  try{
    const res=await fetch('/api/village',{signal:AbortSignal.timeout(9000)});
    if(!res.ok)throw new Error();
    latest=await res.json();
    $('connection').className='connection online';$('connection').replaceChildren(el('i'),document.createTextNode('World online'));
    if(!frozen){state=latest;render();}
    loadGround(latest.world.mapRevision);
  }catch{
    $('connection').className='connection';$('connection').replaceChildren(el('i'),document.createTextNode('Reconnecting'));
    if(!state)$('summary').textContent='Waiting for the village server. Reconnecting automatically…';
  }finally{setTimeout(refresh,2500);}
}
$('freeze').addEventListener('click',()=>{
  if(!state)return;
  frozen=!frozen;
  $('freeze').setAttribute('aria-pressed',String(frozen));$('freeze').textContent=frozen?'Resume live view':'Pause view';
  $('connection').title=frozen?'The view is paused. The village clock continues to run.':'';
  if(!frozen&&latest){state=latest;render();}
});
for(const btn of document.querySelectorAll('[data-tab]'))btn.addEventListener('click',()=>{tab=btn.dataset.tab;render();});
for(const btn of document.querySelectorAll('[data-view]'))btn.addEventListener('click',()=>show(btn.dataset.view));
$('zoom-in').addEventListener('click',()=>map.zoom(1.4));
$('zoom-out').addEventListener('click',()=>map.zoom(1/1.4));
$('zoom-home').addEventListener('click',()=>map.home());
$('pick-resident').addEventListener('change',e=>choose(e.target.value));
$('event-type').addEventListener('change',render);
window.addEventListener('hashchange',navigate);
navigate();refresh();
