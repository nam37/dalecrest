import { createMap } from './map.js';
import { dateOf, formatDate } from '/engine/calendar.mjs';
import { light, skyOver } from '/ambient.js';
import { residentCard, eventCard, kinds, portrait as likeness, whyText, choiceExplanation, doing as doingAt } from '/card.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
const names = { village: 'Village observatory', residents: 'Village residents', chronicle: 'Village chronicle' };
const stores = { grain:'Barley', flour:'Flour', bread:'Bread', wood:'Firewood', cloth:'Linen', water:'Water', repair:'Building repairs' };
const hallStores = { game:'Undressed game', meat:'Game meat', hide:'Raw hides', fish:'Fresh fish', cooked:'Cooked meals', preserved:'Preserved portions', leather:'Leather' };
let state, latest, frozen=false, selected='agnes', tab='life', route='village', rosterSignature='';
let ground=null, viewMode='plan', walk=null, loadingWalk=false;
const map = createMap($('map'), choose, {
  resident: (actor, others) => residentCard(actor, { index: state.actors.findIndex(a => a.id === actor.id), names: state.locations, minute: state.world.minute, others }),
  event: (events, spot) => eventCard(events, { names: state.locations, minute: state.world.minute, place: spot.id }),
});
const capacity = { grain:44, flour:34, bread:32, wood:32, cloth:12, repair:14, water:28 };

function displayLatest() {
  state = latest;
  if (ground !== state.map) {
    ground = state.map;
    map.setMap(ground, state.locations);
    walk?.setMap(ground);
  }
  render();
}
async function show(mode) {
  viewMode = mode;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('map').hidden = mode !== 'plan'; $('walk').hidden = mode !== 'walk';
  document.querySelector('.map-zoom').hidden = mode !== 'plan';
  $('walk-caption').hidden = mode !== 'walk';
  for (const item of document.querySelectorAll('.plan-only')) item.hidden = mode !== 'plan';
  $('map-hint').textContent = mode === 'plan' ? 'Drag to pan · click, then scroll to zoom' : 'Drag to look around · click, then scroll to move closer · click a resident to follow';
  if (mode === 'walk' && !walk && !loadingWalk) {
    loadingWalk = true;
    $('walk-caption').textContent = 'Opening the village at eye level…';
    try {
      const { createWalk } = await import('/view3d.js');
      walk = createWalk($('walk'), choose);
      if (ground) walk.setMap(ground);
    } catch { $('walk-caption').textContent = 'This browser could not open the walking view.'; return; }
    finally { loadingWalk = false; }
  }
  walk?.setActive(viewMode === 'walk' && route === 'village');
  if (viewMode === 'plan') map.redraw();
  render();
}

const doing = actor => doingAt(actor, state.locations);
function chip(kind, text, title) {
  const node = el('span', 'basis basis-' + kind, text);
  if (title) node.title = title;
  return node;
}

function time(minute) {
  const hour = Math.floor(minute / 60) % 24;
  return (hour % 12 || 12) + ':' + String(minute % 60).padStart(2,'0') + (hour < 12 ? ' am' : ' pm');
}
// A date as a neighbour would say it: "2 August", with the year only when it is not this one.
function date(minute) {
  const other = state && dateOf(minute).year !== dateOf(state.world.minute).year;
  return formatDate(minute, other ? 'full' : 'day');
}

const portrait = actor => likeness(state.actors.findIndex(a => a.id === actor.id));

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
  const address='#village/'+id;
  if (location.hash===address) { render(); return; }
  // Moving between residents on the village page replaces the address instead of filling the history.
  if (route==='village') { history.replaceState(null,'',address); navigate(); }
  else location.hash=address;
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
    if(!pre){pre=el('pre','raw'); pre.tabIndex=0; pre.setAttribute('aria-label','Resident record for '+actor.name); detail.replaceChildren(pre);}
    const top=pre.scrollTop;
    pre.textContent=JSON.stringify(actor,(key,value)=>key==='model'?undefined:value,2); pre.scrollTop=top; return;
  }
  detail.replaceChildren();
  const archive = el('a', '', 'Request history');
  archive.href = '/requests.html?resident=' + encodeURIComponent(actor.id);
  const requests = block('Help requests');
  for (const r of Object.values(state.world.helpRequests || {})) {
    if (r.askerId !== actor.id && r.helperId !== actor.id) continue;
    const a = el('a', 'goal', r.asker + ' asked ' + r.helper + ' to ' + r.terms +
      ' · ' + (r.status === 'accepted' ? 'Promised' : 'Awaiting a reply'));
    a.href = '/requests.html?request=' + encodeURIComponent(r.id);
    const item = el('p');
    item.append(a);
    requests.append(item);
  }
  requests.append(archive);
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
    detail.append(requests);
    return;
  }
  const activity=actor.action;
  const at=state.locations[activity.target]?.name || activity.target;
  if (activity.kind === 'waiting') {
    const waiting = block('At '+at, el('strong','activity','Deciding what to do next'), chip('waiting','Deciding'));
    if (activity.reason) waiting.append(el('p','reason',activity.reason));
    if (activity.why) waiting.append(el('p','reason',whyText(activity.why)));
    const since = Number.isFinite(activity.since) ? 'Since '+date(activity.since)+' at '+time(activity.since) : '';
    if (since) waiting.append(el('p','reason',since));
    detail.append(waiting);
  } else {
    const travelling = activity.phase === 'travelling';
    const now = block(travelling ? 'On the way' : 'At '+at, el('strong','activity',doing(actor)));
    if (travelling) now.append(el('p','reason','On arrival · '+activity.label));
    // How this activity came about: a fresh choice by the model, or routine on a choice it made earlier.
    const basis = activity.basis;
    if (basis?.kind === 'standing') {
      now.append(chip('standing','Routine','Following an earlier choice'),
        el('p','reason','Following the choice made '+date(basis.since)+' at '+time(basis.since)+'.'));
    } else {
      if (basis?.kind === 'fresh') now.append(chip('fresh','Fresh choice','A choice the resident just made'));
      now.append(el('p','reason',choiceExplanation(activity)));
    }
    detail.append(now);
    if(actor.plan)detail.append(block(actor.plan.method==='choice'?'Priority · '+actor.plan.focus:'Today’s intention',el('p','goal',actor.plan.reason)));
  }
  const event = state.events.find(e => e.type !== 'plan' && e.actorIds.includes(actor.id));
  if (event) detail.append(block('Latest chronicle event', el('p','memory-text',event.text),
    el('time','goal',date(event.minute)+' · '+time(event.minute))));
  const { barleyStrip, cottages, fields, minute } = state.world;
  if (barleyStrip?.keeper === actor.id) {
    const { site, moisture, weeds } = barleyStrip;
    const growing = [state.locations[site]?.name || 'Barley', moisture <= 1 ? 'Dry soil' : 'Moist soil',
      weeds >= 2 ? 'Crowded with weeds' : 'Few weeds', fields?.[site] >= 3 ? 'Ready to reap' : 'Growing'];
    detail.append(block('Barley strip', el('p','goal', growing.join(' · '))));
  }
  const cottage = cottages?.[actor.home], repairs = [];
  if (cottage?.brokenBed) repairs.push('Broken bed');
  if (minute >= cottage?.floorDue) repairs.push('Rotten floorboard');
  if (minute >= cottage?.sweepDue) repairs.push('Needs sweeping');
  if (repairs.length) detail.append(block('Cottage', el('p','goal',repairs.join(' · '))));
  detail.append(requests);
  detail.append(block('Desires',...(actor.desires||[]).map(d=>el('p','goal',d.label))));
  const needs=block('Current needs');
  for(const [key,val] of Object.entries(actor.needs)){
    const n=Math.round(val), row=el('div',n>=70?'need urgent':'need'), track=el('span','track'), fill=el('i');
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
// Meals, shifts and the model's activity choices are the routine of the day. Highlights leave them out.
const routine = new Set(['plan','meal','work']);
const filters = { highlights: e => !routine.has(e.type), '': () => true };
const shown = (events, filter) => events.filter(filters[filter] || (e => e.type === filter));
// Opens the village map on the spot where a chronicle entry happened.
function locate(event) {
  if (route !== 'village') { history.pushState(null, '', '#village/' + selected); navigate(); }
  if (viewMode !== 'plan') show('plan');
  map.focus(event);
  $('map').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function journal(target,events,withDay=false) {
  // The list is left alone while it has nothing new to say, so a click on it is never lost to a redraw.
  const signature=events.map(e=>e.id).join(',')+'|'+withDay+'|'+(state?formatDate(state.world.minute):'');
  if(target.dataset.signature===signature)return;
  target.dataset.signature=signature;
  const fragment=document.createDocumentFragment();
  let day=null;
  for (const e of events) {
    if (withDay && formatDate(e.minute)!==day) { day=formatDate(e.minute); fragment.append(el('h3','journal-day',formatDate(e.minute,'long'))); }
    const row=el('div','journal-row'), entry=el('p');
    entry.append(el('span','kind kind-'+e.type,kinds[e.type]||e.type),document.createTextNode(e.text));
    if (e.requestId) {
      const a = el('a', '', 'Request history');
      a.href = '/requests.html?request=' + encodeURIComponent(e.requestId);
      entry.append(' ', a);
    }
    if (e.place) {
      const where = el('button', 'where', 'Show on map');
      where.type = 'button';
      where.title = state.locations[e.place.id]?.name ? 'At ' + state.locations[e.place.id].name : 'Where this happened';
      where.addEventListener('click', () => locate(e));
      entry.append(' ', where);
    }
    // In the short list on the village page, an entry from an earlier day says so.
    const earlier = !withDay && state && formatDate(e.minute) !== formatDate(state.world.minute);
    row.append(el('time','journal-time',(earlier ? formatDate(e.minute,'short')+' · ' : '')+time(e.minute)),entry);
    fragment.append(row);
  }
  if(!events.length)fragment.append(el('p','empty','Nothing of this kind in the latest 100 records.'));
  target.replaceChildren(fragment);
}
function roster() {
  const signature=state.actors.map(a=>[a.id,a.name,a.role,a.backstory,doing(a)]).join('|');
  if(signature===rosterSignature)return;
  rosterSignature=signature;
  const cards=state.actors.map(a=>{
    const card=el('article','resident-card'),btn=el('button','record-button','Follow');
    btn.type='button'; btn.setAttribute('aria-label','Follow '+a.name+' in the village'); btn.addEventListener('click',()=>choose(a.id));
    card.append(who(a),el('p','card-doing',doing(a)),el('p','bio',a.backstory),btn);return card;
  });
  $('roster').replaceChildren(...cards);
}
function render() {
  if(!state)return;
  const {world,actors,events,planner}=state;
  $('title').textContent=names[route];
  $('summary').textContent={village:actors.length+' residents living and working in a medieval parish.',residents:'The people, trades, and households of Dalecrest.',chronicle:'What has happened lately, from the latest 100 entries in the village records.'}[route];
  // The clock gives the date in full, with its weekday where there is room.
  $('day').textContent=formatDate(world.minute, matchMedia('(max-width: 690px)').matches ? 'full' : 'long');
  $('time').textContent=time(world.minute);
  $('clock').title='Day '+dateOf(world.minute).villageDay+' since Dalecrest was founded';
  // The season and the weather sit under the hour, and the mark beside them follows the sky.
  const night=light(world.minute).night, sky=state.map?skyOver(world.minute,state.map.seed):null;
  $('clock').classList.toggle('night',night); $('orb').textContent=sky?.snow?'❄':sky?.rain?'☂':night?'☾':sky?.sky==='overcast'?'☁':'☼';
  $('weather').textContent=sky?sky.label:'';
  $('weather').title=sky?'About '+Math.round(sky.temp)+'°C as we would measure it':'';
  // What happened in the last hour and a half is pinned to the map where it happened.
  const extras={coldHearths:world.coldHearths||[], events:shown(events,'highlights').filter(e=>e.place&&world.minute-e.minute<=90).slice(0,12)};
  // In the village the map is the page. Its title gives way and the clock moves onto the plate.
  $('page-title').hidden=route==='village';
  $('planner-status').textContent=planner.configured?'Village decisions · '+planner.state:'Village decisions · local rules';
  if(route==='village'){
    const actor=actors.find(a=>a.id===selected)||actors[0]; selected=actor.id;
    const motionMs = frozen ? 0 : Math.max(1, state.tickDueAt - performance.now());
    if (state.tickMs > 0 && state.tickMinutes > 0) {
      extras.liveTick = { map: ground, minute: world.minute, minutes: state.tickMinutes, ms: state.tickMs, endsAt: state.tickDueAt };
    }
    map.update(actors,selected,state.locations,motionMs,world.minute,extras);
    if(walk&&viewMode==='walk'){
      walk.update(actors,selected,world.minute,motionMs,extras);
      $('walk-caption').textContent='Following '+actor.name+' · '+doing(actor);
    }
    renderProfile(actor);renderAffairs();
    $('map-count').textContent=actors.length+' residents';
    const notable=shown(events,'highlights');
    journal($('recent-events'),(notable.length?notable:events).slice(0,5));
    const stocked = [...Object.entries(stores), ...Object.entries(hallStores).filter(([key]) => world.supplies[key] > 0)];
    $('supplies').replaceChildren(...stocked.map(([key,name])=>{
      const row=el('div','supply'),amount=el('strong','',world.supplies[key]);
      amount.append(el('small','',' / '+(world.capacity?.[key]??capacity[key])));
      row.append(el('span','',name),amount);return row;
    }));
    // A morning when the woodpile did not go round is worth saying where the firewood is counted.
    const without=extras.coldHearths.length;
    if(without) $('supplies').append(el('p','affair-note','No firewood reached '+without+(without===1?' hearth':' hearths')+' this morning.'));
  }else if(route==='residents')roster();
  else journal($('all-events'),shown(events,$('event-type').value),true);
}
function navigate(){
  // #village/agnes opens the village following Agnes.
  const [key,who]=location.hash.slice(1).split('/');
  route=Object.hasOwn(names,key)?key:'village';
  if(who) selected=who;
  for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==route;
  for(const link of document.querySelectorAll('nav a')){
    if(link.hash==='#'+route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  walk?.setActive(route==='village' && viewMode==='walk');
  (route==='village' ? $('plate-clock') : $('title-clock')).append($('clock'));
  $('page-title').hidden=route==='village' && Boolean(state);
  render();
}
async function refresh(){
  try{
    const res=await fetch('/api/village?mapRevision='+(latest?.map.revision ?? -1),{signal:AbortSignal.timeout(9000)});
    if(!res.ok)throw new Error();
    const next=await res.json();
    next.tickDueAt = performance.now() + next.nextTickInMs;
    next.map ??= latest?.map;
    if (!next.map || next.map.revision !== next.world.mapRevision) throw new Error('Village map revision mismatch');
    latest=next;
    $('connection').className='connection online';$('connection').replaceChildren(el('i'),document.createTextNode('World online'));
    if(!frozen) displayLatest();
  }catch{
    $('connection').className='connection';$('connection').replaceChildren(el('i'),document.createTextNode('Reconnecting'));
    if(!state)$('summary').textContent='Waiting for the village server. Reconnecting automatically…';
  }finally{setTimeout(refresh,2500);}
}
$('freeze').addEventListener('click',()=>{
  if(!state)return;
  frozen=!frozen;
  $('freeze').setAttribute('aria-pressed',String(frozen));$('freeze').textContent=frozen?'Resume':'Pause';
  $('connection').title=frozen?'The view is paused. The village clock continues to run.':'';
  if(frozen) render(); else displayLatest();
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
