import { createMap } from './map.js';
import { bindMapFullscreen } from './map-fullscreen.js';
import { dateOf, formatDate } from '/engine/calendar.mjs';
import { light, skyOver } from '/ambient.js';
import { createDial } from './clock-dial.js';
import { residentCard, eventCard, kinds, whyText, residentCaption, choiceExplanation, doing as doingAt } from '/card.js';
import { portrait } from './portrait.js';
import { createDirector } from '/director.js';
import { ageOf } from '/engine/lives.mjs';
import { conditionWords } from '/engine/goals.mjs';
import { childResidents } from '/engine/children.mjs';
import { batchTotal, cottageBatches } from '/engine/fresh-food.mjs';
import { farmSites, sheepCount } from '/engine/smallholding.mjs';
import { bindVillageSound } from './village-audio.js';
import { applyVillageChanges, sameGround } from './village-update.js';
import { createResidentHeat } from './resident-heat.js';
import { dayLink, housing, householdLink, mootLink, promiseLink, residentLink } from './record-links.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, value) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = value;
  return node;
};
const link = (text, href, cls) => Object.assign(el('a', cls, text), { href });
const names = { village: 'Village observatory', residents: 'Village residents', chronicle: 'Village chronicle' };
const stores = { grain:'Barley', flour:'Flour', bread:'Loaves · storehouse', wood:'Firewood', cloth:'Linen · storehouse', water:'Water', repair:'Building repairs' };
const hallStores = { game:'Undressed game', meat:'Game meat', mutton:'Raw mutton', hide:'Raw hides', fish:'Fresh fish', cooked:'Cooked meals',
  peas:'Peas · hall', apples:'Apples · hall', preserved:'Salt fish and smoked meat · storehouse', leather:'Leather · storehouse', hay:'Hay · pasture' };
const clockPeriods = { day: 'Day pace', night: 'Night pace' };
let dial = null;
let state, latest, frozen=false, selected='agnes', tab='life', route='village', rosterSignature='', directorySignature='';
let villagePeople = [];
let ground=null, viewMode='plan', walk=null, loadingWalk=false;
// The chronicle entry the walking view is holding on, if any.
let held=null;
// A visitor who arrives with no one in mind is shown around: the director picks who or what to watch
// until they choose for themselves. Turning it off is remembered in this browser.
const director = createDirector();
const recall = key => { try { return localStorage.getItem(key); } catch { return null; } };
const keep = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };
let watching = !location.hash.includes('/') && recall('dalecrest.watch') !== 'off', scene = null;
const map = createMap($('map'), choose, {
  resident: (actor, others) => residentCard(actor, { names: state.locations, minute: state.world.minute, others, pets: state.world.pets ?? [] }),
  event: (events, spot) => eventCard(events, { names: state.locations, minute: state.world.minute, place: spot.id }),
  steered: () => watch(false),
});
const residentHeat = createResidentHeat($('detail'));
const capacity = { grain:44, flour:34, bread:32, wood:32, cloth:12, repair:14, water:28 };

function displayLatest() {
  state = latest;
  villagePeople = [...state.actors, ...childResidents(state.world)];
  if (leaveMissingResident()) return;
  if (ground !== state.map) {
    ground = state.map;
    map.setMap(ground, state.locations);
    walk?.setMap(ground);
  }
  direct(false);
  render();
}
async function show(mode) {
  viewMode = mode;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === mode));
  $('map').hidden = mode !== 'plan'; $('walk').hidden = mode !== 'walk';
  for (const item of document.querySelectorAll('.plan-only')) item.hidden = mode !== 'plan';
  $('map-hint').textContent = mode === 'plan' ? 'Drag to pan · click, then scroll to zoom' : 'Drag to look around · click, then scroll to move closer · click a resident to follow';
  if (mode === 'walk' && !walk && !loadingWalk) {
    loadingWalk = true;
    caption({ line: 'Opening the village at eye level…' });
    try {
      const { createWalk } = await import('/view3d.js');
      walk = createWalk($('walk'), choose, note => locate(note.events[0]));
      if (ground) walk.setMap(ground);
      if (scene) stage();
    } catch { caption({ line: 'This browser could not open the walking view.' }); return; }
    finally { loadingWalk = false; }
  }
  walk?.setActive(viewMode === 'walk' && route === 'village');
  // A spot being held on goes with the reader from one view to the other.
  if (held && mode === 'plan') { map.focus(held); release(); }
  if (viewMode === 'plan') map.redraw();
  render();
}

const doing = actor => doingAt(actor, state.locations);
// The plate's caption: a small heading, what is in view, a line of why, and a way back.
function caption(c) {
  $('caption').hidden = !c;
  if (!c) return;
  for (const [id, text] of [['caption-kicker', c.kicker], ['caption-line', c.line], ['caption-why', c.why], ['caption-back', c.back]]) {
    $(id).hidden = !text;
    if ($(id).textContent !== (text || '')) $(id).textContent = text || '';
  }
}
function release() { held = null; walk?.hold(null); }

// Asks the director what to show, and turns both views to it when the scene changes.
function direct(repaint = true) {
  if (!watching || !state || frozen || route !== 'village' || document.hidden) return;
  const next = director.pick({ ...state, actors: villagePeople }, performance.now()), cut = next.key !== scene?.key;
  scene = next;
  if (cut) { stage(); if (repaint) render(); }
}
function stage() {
  held = null;
  if (scene.actorId && villagePeople.some(a => a.id === scene.actorId)) selected = scene.actorId;
  if (scene.kind === 'resident') { map.watch({ id: scene.actorId }); walk?.hold(null); }
  else if (scene.kind === 'event') { map.watch(scene.event.place); walk?.hold(scene.event); }
  else {
    const green = state.map.places.find(p => p.id === 'green') || state.map.places[0];
    map.watch({ whole: true }); walk?.hold({ place: { x: green.x, y: green.y, id: green.id } }, { dist: 32, pitch: 0.62 });
  }
}
function watch(on, remember = false) {
  if (on === watching) return;
  watching = on; scene = null; director.reset();
  if (remember) keep('dalecrest.watch', on ? 'on' : 'off');
  if (on) {
    if (tab === 'heat') tab = 'life';
    // A watch belongs to no one resident, so the address goes back to the village itself.
    if (route === 'village' && location.hash !== '#village') history.replaceState(null, '', '#village');
    direct(false);
  } else { map.watch(null); if (!held) walk?.hold(null); }
  render();
}
// What the caption says about the scene being watched.
function narration() {
  const { world, locations } = state;
  if (scene.kind === 'resident') {
    const actor = villagePeople.find(a => a.id === scene.actorId);
    return actor ? { kicker: scene.kicker, ...residentCaption(actor, locations) } : null;
  }
  if (scene.kind === 'event') {
    const at = locations[scene.event.place.id]?.name, ago = world.minute - scene.event.minute;
    return { kicker: (at ? 'At ' + at : 'Out of doors') + ' · ' + (ago < 2 ? 'just now' : ago + ' minutes ago'), line: scene.event.text };
  }
  const night = light(world.minute).night, all = scene.indoors >= scene.residents;
  if (!scene.residents) return { kicker: 'The village', line: 'No residents are in the parish.' };
  return { kicker: night ? 'The village by night' : 'The village', line: all ? 'Everyone is indoors.' + (night ? ' The lit windows are the hearths still burning.' : '')
    : scene.indoors + ' of ' + scene.residents + ' residents are indoors.' };
}
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

function who(actor) {
  const row=el('div','profile-top'), text=el('div');
  const name = el('h3');
  name.append(actor.child ? actor.name : link(actor.name, residentLink(actor)));
  text.append(name,el('p','role',actor.child ? 'Age ' + actor.age : actor.role));
  row.append(portrait(actor),text);
  return row;
}
function block(label, ...children) {
  const div=el('div','detail-block');
  div.append(el('div','eyebrow',label),...children);
  return div;
}
function choose(id) {
  const person = villagePeople.find(a => a.id === id);
  if (!person) return;
  watch(false);
  release();
  selected=id;
  if (person.child) tab='life';
  const address='#village/'+id+(tab==='heat'?'/heat':'');
  if (location.hash===address) { render(); return; }
  // Moving between residents on the village page replaces the address instead of filling the history.
  if (route==='village') { history.replaceState(null,'',address); navigate(); }
  else location.hash=address;
}
function renderProfile(actor) {
  const picker = $('pick-resident'), residents = villagePeople;
  const optionName = person => person.child ? person.name : person.name.split(' ')[0];
  if (picker.options.length !== residents.length || [...picker.options].some((option, i) =>
    option.value !== residents[i].id || option.text !== optionName(residents[i]))) {
    picker.replaceChildren(...residents.map(a => new Option(optionName(a), a.id)));
  }
  picker.disabled = !actor;
  document.querySelector('.resident-panel .tabs').hidden = Boolean(actor?.child);
  if (!actor) {
    residentHeat.hide();
    $('profile').replaceChildren(el('p', 'empty', 'No residents are in the parish.'));
    $('detail').replaceChildren();
    return;
  }
  if (actor.child) {
    residentHeat.hide();
    picker.value = actor.id;
    $('profile').replaceChildren(who(actor));
    const action = actor.action, home = state.locations[actor.home], at = state.locations[action.target];
    $('detail').replaceChildren(block(action.phase === 'travelling' ? 'On the way' : at?.name || 'In the village',
      el('strong', 'activity', doing(actor)),
      ...(action.phase === 'travelling' ? [el('p', 'reason', action.label)] : [])),
      block('Home', link(home?.name || 'Household record', householdLink(actor.home), 'where')));
    return;
  }
  const traits=el('div','trait-list');
  for(const t of actor.traits) traits.append(el('span','trait',t));
  $('profile').replaceChildren(who(actor),traits);
  picker.value=actor.id;
  for(const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed',String(b.dataset.tab===tab));
  const detail=$('detail');
  if (tab === 'heat') {
    residentHeat.show({ actor, map: state.map, minute: state.world.minute, locations: state.locations });
    return;
  }
  residentHeat.hide();
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
    a.href = promiseLink(r.id);
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
    // Warmth is fondness and trust is how far they would rely on someone. They are kept apart.
    const bonds=Object.entries(actor.relationships).filter(([id])=>state.actors.some(a=>a.id===id)).sort((a,b)=>b[1]-a[1]).slice(0,3);
    detail.append(memories,block('Closest ties',...bonds.map(([id,w])=>{
      const row=el('p','goal',state.actors.find(a=>a.id===id).name);
      row.append(el('small','tie',' · warmth '+Math.round(w)+' · trust '+Math.round(actor.trust?.[id]??40)));
      return row;
    })));
    detail.append(requests);
    return;
  }
  const activity=actor.action;
  const at=state.locations[activity.target]?.name || activity.target;
  const where = at ? 'At '+at : 'Out in the parish';
  if (activity.kind === 'waiting') {
    const waiting = block(where, el('strong','activity','Deciding what to do next'), chip('waiting','Deciding'));
    if (activity.reason) waiting.append(el('p','reason',activity.reason));
    if (activity.why) waiting.append(el('p','reason',whyText(activity.why, activity.blockedVisit, state.locations)));
    const since = Number.isFinite(activity.since) ? 'Since '+date(activity.since)+' at '+time(activity.since) : '';
    if (since) waiting.append(el('p','reason',since));
    detail.append(waiting);
  } else {
    const travelling = activity.phase === 'travelling';
    const now = block(travelling ? 'On the way' : where, el('strong','activity',doing(actor)));
    if (travelling) now.append(el('p','reason','On arrival · '+activity.label));
    // How this activity came about: a fresh choice by the model, or routine on a choice it made earlier.
    const basis = activity.basis;
    if (basis?.kind === 'standing') {
      now.append(chip('standing','Routine','Following an earlier choice'),
        el('p','reason','Following the choice made '+date(basis.since)+' at '+time(basis.since)+'.'));
    } else {
      if (basis?.kind === 'fresh') now.append(chip('fresh','Fresh choice','A choice the resident just made'));
      now.append(el('p','reason',choiceExplanation(activity, state.locations)));
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
  // Their own life and household: age, family, health, and what the house has laid in.
  const life=['Aged '+ageOf(actor,minute)];
  if(actor.spouseName) life.push('married to '+actor.spouseName);
  else if(actor.courting) life.push('walking out with '+actor.courting.name);
  if(actor.proposal) life.push('asked to marry by '+actor.proposal.name);
  if(actor.expecting) life.push('expecting a child about '+formatDate(actor.expecting.due,'day'));
  const kids=(cottage?.children||[]).map(c=>c.name+', '+Math.max(0,ageOf(c,minute)));
  const household=block('Life and household', el('p','goal',life.join(' · ')));
  const home = state.locations[actor.home];
  if (home && housing(home.kind)) household.append(link(home.name, householdLink(actor.home), 'where'));
  if(actor.illness) household.append(chip('ill','Ill', 'Unwell since '+date(actor.illness.since)), el('p','reason',{hungry:'A fever brought on by hunger',cold:'A chill on the chest',worn:'Exhaustion',age:'An ague of old age'}[actor.illness.cause]+(actor.illness.severity>=2?'. Too ill to work.':'.')));
  if(kids.length) household.append(el('p','goal','Children: '+kids.join(' · ')));
  if(cottage && Number.isFinite(cottage.woodpile)) {
    const preserved = batchTotal(cottage.preservedFood);
    const food = [(cottage.larder||0)+' loaves'];
    if (preserved) food.push(preserved+' preserved '+(preserved===1?'portion':'portions'));
    const peas = batchTotal(cottageBatches(cottage, 'peas')), apples = batchTotal(cottageBatches(cottage, 'apples'));
    if (peas) food.push(peas+(peas===1?' portion of peas':' portions of peas'));
    if (apples) food.push(apples+(apples===1?' apple':' apples'));
    household.append(el('p','goal','Woodpile at home: '+Math.floor(cottage.woodpile)+' bundles · Larder: '+food.join(', ')
      +(Number.isFinite(cottage.ration)?' · Bread due at the storehouse: '+Math.floor(cottage.ration):'')));
  }
  detail.append(household);
  detail.append(requests);
  // Goals: those the record can settle say how, and those on evidence say whom they concern. The latest
  // settled goals follow, with how they ended.
  const goalRows=(actor.goalBook||[]).map(g=>{
    const row=el('p','goal',g.text);
    const about=g.about&&state.actors.find(a=>a.id===g.about)?.name;
    row.append(el('small','tie',g.condition?' · '+conditionWords(g.condition,state.locations):about?' · concerns '+about:''));
    return row;
  });
  const ended=(actor.goalHistory||[]).filter(g=>['met','missed','overtaken'].includes(g.status)).slice(-2).reverse()
    .map(g=>el('p','reason',{met:'Met',missed:'Missed',overtaken:'Overtaken'}[g.status]+' '+date(g.settled)+': '+g.text));
  detail.append(block('Goals',...(goalRows.length?goalRows:(actor.desires||[]).map(d=>el('p','goal',d.label))),...ended));
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
  const sitting = state.world.moot;
  const panel = $('affairs'), last = affairs.mootHistory?.at(-1);
  const signature = JSON.stringify([affairs.moot, sitting?.attendees?.length, sitting?.ballots?.length,
    affairs.works, affairs.talk, last?.id, affairs.bylaws]);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  const opened = new Set([...panel.querySelectorAll('details[open]')].map(detail => detail.dataset.motion));
  if (sitting?.agenda) {
    const votes = sitting.ballots.length, expected = sitting.attendees.length * sitting.agenda.length;
    const current = el('p','affair-note');
    current.append(link('The moot', mootLink(sitting.id ?? 'moot-' + sitting.at)), ' is sitting at the hall. '+sitting.attendees.length+
      ' present, '+sitting.quorum+' needed. '+votes+' of '+expected+' ballots returned.');
    rows.push(current);
  } else if (affairs.moot != null) {
    const scheduled = el('p','affair-note');
    scheduled.append(link('The moot', mootLink('moot-' + affairs.moot)), ' meets at the hall, '+date(affairs.moot)+' at '+time(affairs.moot)+'.');
    rows.push(scheduled);
  }
  for(const work of affairs.works){
    const row=el('div','affair'), track=el('span','track'), fill=el('i');
    fill.style.width=Math.round(100*work.done/work.need)+'%'; track.append(fill);
    row.append(el('span','affair-title',work.title+(work.where?' · '+work.where:'')),track,el('span','num',work.done+'/'+work.need));
    rows.push(row);
  }
  for(const talk of affairs.talk){
    const row=el('div','affair talk');
    const positions = [talk.voices+' of '+talk.needed+' backers', talk.opposed && talk.opposed+' opposed', talk.undecided && talk.undecided+' undecided'].filter(Boolean);
    row.append(el('span','affair-title',talk.title),el('span','num',positions.join(' · ')));
    rows.push(row);
  }
  if (last) {
    const heading = el('h3', 'moot-heading');
    heading.append(link('Last moot · '+date(last.at), mootLink(last.id ?? 'moot-' + last.at)));
    rows.push(heading);
    rows.push(el('p', 'reason', last.attendees.length+' attended. Quorum was '+last.quorum+'.'));
    for (const item of last.items) {
      const result = item.status[0].toUpperCase()+item.status.slice(1);
      rows.push(el('p','goal',item.title[0].toUpperCase()+item.title.slice(1)+' · '+result+(item.reason?' ('+item.reason+')':'')));
      rows.push(el('p','reason',item.support+' for, '+item.oppose+' against, '+item.abstain+' abstained'+(item.missing?', '+item.missing+' unreturned':'')+'.'));
      if (last.attendees.length) {
        const roll = el('details','moot-roll');
        roll.dataset.motion = last.id + '/' + item.key;
        roll.open = opened.has(roll.dataset.motion);
        roll.append(el('summary','','Roll call'));
        for (const id of last.attendees) {
          const vote = last.ballots.find(b => b.actorId === id && b.proposalKey === item.key);
          const resident = state.actors.find(a => a.id === id);
          const name = resident?.name || id;
          const wording = vote ? { support:'For', oppose:'Against', abstain:'Abstained' }[vote.choice] : 'Unreturned';
          roll.append(el('p','reason',name+' · '+wording));
        }
        rows.push(roll);
      }
    }
  }
  const allowance = affairs.bylaws?.allowance;
  if (allowance) rows.push(el('p','affair-note','Bread allowance in force since '+date(allowance.enactedAt)+' · '+allowance.adultBread+' loaves per adult each day.'));
  if(!rows.length) rows.push(el('p','empty','Nothing is being built or argued over today.'));
  panel.replaceChildren(...rows);
}
// Every entry carries a salience. The snapshot holds the notable ones; meals, shifts and other routine stay in
// the residents' own memories and are fetched only when the full chronicle asks for them.
const notableEntry = e => (e.salience ?? 3) >= 3;
const shown = (events, filter) => filter === 'highlights' ? events.filter(notableEntry) : events.filter(e => !filter || e.type === filter);
let fuller = { filter: null, events: [], version: null, loading: false };
async function fullChronicle(filter) {
  const version = state.eventVersion;
  if (fuller.filter === filter && (fuller.loading || fuller.version === version)) return;
  const reading = { filter, events: fuller.filter === filter ? fuller.events : [], version: null, loading: true };
  fuller = reading;
  try {
    const res = await fetch('/api/events' + (filter ? '?type=' + encodeURIComponent(filter) : ''), { signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const events = await res.json();
      if (fuller !== reading) return;
      Object.assign(reading, { events, version, loading: false });
      render();
    }
  } catch { /* The list keeps what it showed last. */ }
  reading.loading = false;
}
// Turns the village to the spot where a chronicle entry happened, in whichever view is open.
function locate(event) {
  if (route !== 'village') { history.pushState(null, '', '#village' + (selected ? '/' + selected : '')); navigate(); }
  watch(false);
  if (viewMode === 'walk' && walk) { held = event; walk.hold(event); render(); }
  else map.focus(event);
  document.querySelector('.map-area').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function journal(target,events,withDay=false) {
  // The list is left alone while it has nothing new to say, so a click on it is never lost to a redraw.
  const signature=events.map(e=>e.id+(e.account?'*':'')).join(',')+'|'+withDay+'|'+(state?formatDate(state.world.minute):'');
  if(target.dataset.signature===signature)return;
  target.dataset.signature=signature;
  const fragment=document.createDocumentFragment();
  let day=null;
  for (const e of events) {
    if (withDay && formatDate(e.minute)!==day) { day=formatDate(e.minute); fragment.append(el('h3','journal-day',formatDate(e.minute,'long'))); }
    const row=el('div','journal-row'), entry=el('p');
    entry.append(el('span','kind kind-'+e.type,kinds[e.type]||e.type),document.createTextNode(e.text));
    if (e.requestId) {
      entry.append(' ', link('Request history', promiseLink(e.requestId)));
    }
    if (e.mootId) entry.append(' ', link('Moot record', mootLink(e.mootId)));
    if (e.place) {
      const where = el('button', 'where', 'Show where');
      where.type = 'button';
      where.title = state.locations[e.place.id]?.name ? 'At ' + state.locations[e.place.id].name : 'Where this happened';
      where.addEventListener('click', () => locate(e));
      entry.append(' ', where);
    }
    if (e.account) entry.append(el('span','civic-account','Model-written account · '+e.account));
    // In the short list on the village page, an entry from an earlier day says so.
    const earlier = !withDay && state && formatDate(e.minute) !== formatDate(state.world.minute);
    const stamp = el('time','journal-time');
    stamp.append(link((earlier ? formatDate(e.minute,'short')+' · ' : '')+time(e.minute),
      dayLink(e.minute) + (notableEntry(e) ? '#event-' + e.id : '')));
    row.append(stamp,entry);
    fragment.append(row);
  }
  if(!events.length)fragment.append(el('p','empty','Nothing of this kind in the latest 100 records.'));
  target.replaceChildren(fragment);
}
function residentDirectory() {
  const homes = Object.values(state.locations).filter(p => housing(p.kind));
  const former = state.world.departed ?? [];
  const signature = JSON.stringify([homes, former]);
  if (signature === directorySignature) return;
  directorySignature = signature;
  const entry = (name, address) => {
    const row = el('li');
    row.append(link(name, address));
    return row;
  };
  $('household-directory').replaceChildren(...homes.map(home => entry(
    ['New cottage', 'Empty cottage'].includes(home.name) ? home.name + ' ' + home.id.split('-').at(-1) : home.name,
    householdLink(home.id))));
  $('former-residents').hidden = !former.length;
  $('former-directory').replaceChildren(...[...former].reverse().map(person =>
    entry(person.name + ' · ' + formatDate(person.minute), residentLink({ ...person, left: person.minute }))));
}
function roster() {
  residentDirectory();
  const signature=JSON.stringify(state.actors.map(a=>[a.id,a.arrived,a.name,a.role,a.backstory,doing(a),a.sex,a.appearance]));
  if(signature===rosterSignature)return;
  rosterSignature=signature;
  const cards=state.actors.map(a=>{
    const card=el('article','resident-card'),btn=el('button','record-button','View in village');
    btn.type='button'; btn.setAttribute('aria-label','View '+a.name+' in the village'); btn.addEventListener('click',()=>choose(a.id));
    card.append(who(a),el('p','card-doing',doing(a)),el('p','bio',a.backstory),btn);return card;
  });
  $('roster').replaceChildren(...cards);
}
function render() {
  if(!state)return;
  const {world,actors,events,planner}=state;
  $('title').textContent=names[route];
  $('summary').textContent={village:actors.length+' residents living and working in a medieval parish.',residents:'The people, trades, and households of Dalecrest.',chronicle:'What has happened lately: the latest 100 notable entries in the village records. Choose a kind to see routine as well.'}[route];
  // The clock gives the date in full, with its weekday where there is room.
  $('day').textContent=formatDate(world.minute, matchMedia('(max-width: 690px)').matches ? 'full' : 'long');
  $('day').href=dayLink(world.minute);
  $('time').textContent=time(world.minute);
  const speed = state.tickMs > 0 && state.tickMinutes > 0
    ? (30000 * state.tickMinutes / state.tickMs).toLocaleString('en', { maximumSignificantDigits: 3 }) + '×'
    : '';
  const pace = speed && [speed, clockPeriods[state.clockPeriod]].filter(Boolean).join(' · ');
  const paceLabel = $('clock-pace');
  if (paceLabel.textContent !== pace) {
    paceLabel.textContent = pace;
    paceLabel.title = speed ? 'Speed relative to 30 real seconds per village minute' : '';
  }
  $('clock').title='Day '+dateOf(world.minute).villageDay+' since Dalecrest was founded';
  // The season and the weather sit under the date, and the dial beside them follows the sun and the sky.
  const night=light(world.minute).night, sky=state.map?skyOver(world.minute,state.map.seed):null;
  $('clock').classList.toggle('night',night); (dial ??= createDial($('dial')))(world.minute, sky);
  $('weather').textContent=sky?sky.label:'';
  $('weather').title=sky?'About '+Math.round(sky.temp)+'°C as we would measure it':'';
  // What happened in the last hour and a half is pinned to the map where it happened.
  const extras = { world, coldHearths:world.coldHearths||[], events:shown(events,'highlights').filter(e=>e.place&&world.minute-e.minute<=90).slice(0,12)};
  // In the village the map is the page. Its title gives way and the clock moves onto the plate.
  $('page-title').hidden=route==='village';
  $('planner-status').textContent=planner.configured?'Village decisions · '+planner.state:'Village decisions · local rules';
  if(route==='village'){
    const actor=villagePeople.find(a=>a.id===selected)||villagePeople[0]; selected=actor?.id;
    $('watch').setAttribute('aria-pressed',String(watching)); $('watch').textContent=watching?'Watching':'Watch';
    document.querySelector('.map-key').hidden=viewMode!=='plan'||watching;
    const motionMs = frozen ? 0 : Math.max(1, state.tickDueAt - performance.now());
    if (state.tickMs > 0 && state.tickMinutes > 0) {
      extras.liveTick = { map: ground, minute: world.minute, minutes: state.tickMinutes, ms: state.tickMs, endsAt: state.tickDueAt };
    }
    map.update(villagePeople,selected,state.locations,motionMs,world.minute,extras);
    if(walk&&viewMode==='walk'){
      walk.update(villagePeople,selected,world.minute,motionMs,extras);
      if(watching&&scene) caption(narration());
      else if(held){
        const at=state.locations[held.place.id]?.name;
        caption({kicker:(at?'At '+at:'Out of doors')+' · '+(formatDate(held.minute)===formatDate(world.minute)?'':date(held.minute)+', ')+time(held.minute),
          line:held.text, back:'Back to '+actor.name.split(' ')[0]});
      } else caption(actor ? {kicker:'Following', ...residentCaption(actor, state.locations)} : null);
    } else if(!loadingWalk) caption(watching&&scene?narration():null);
    renderProfile(actor);renderAffairs();
    const kids = villagePeople.length - actors.length;
    $('map-count').textContent=actors.length+' residents'+(kids ? ' · '+kids+(kids === 1 ? ' child' : ' children') : '');
    const notable=shown(events,'highlights');
    journal($('recent-events'),(notable.length?notable:events).slice(0,5));
    const stocked = [...Object.entries(stores), ...Object.entries(hallStores).filter(([key]) => world.supplies[key] > 0)];
    $('supplies').replaceChildren(...stocked.map(([key,name])=>{
      const row=el('div','supply'),amount=el('strong','',world.supplies[key]);
      amount.append(el('small','',' / '+(world.capacity?.[key]??capacity[key])));
      row.append(el('span','',name),amount);return row;
    }));
    const reserve = world.foodReserve;
    if (Number.isFinite(reserve?.readyDays) && Number.isFinite(reserve.unpreparedDays)) {
      $('supplies').append(el('p','affair-note','At dawn · '+reserve.readyDays.toFixed(2)+' days of food ready to eat · '
        +reserve.unpreparedDays.toFixed(2)+' more days after preparation.'));
    }
    if (state.locations[farmSites.pasture.id] && world.smallholding?.flock) {
      const count = sheepCount(world.smallholding.flock);
      $('supplies').append(el('p','affair-note',count === 0 ? 'The sheep pasture is empty.' : count+' sheep in the pasture · '+world.supplies.hay+' bundles of hay.'));
    }
    // A morning when the woodpile did not go round is worth saying where the firewood is counted.
    const without=extras.coldHearths.length;
    if(without) $('supplies').append(el('p','affair-note','No firewood reached '+without+(without===1?' hearth':' hearths')+' this morning.'));
  }else if(route==='residents')roster();
  else {
    const filter=$('event-type').value;
    if(filter==='highlights') journal($('all-events'),shown(events,'highlights'),true);
    else { fullChronicle(filter); if(fuller.filter===filter) journal($('all-events'),fuller.events,true); }
  }
}
function leaveMissingResident() {
  const [, who] = location.hash.slice(1).split('/');
  if (route !== 'village' || !who || !state || villagePeople.some(actor => actor.id === who)) return false;
  if (who.startsWith('child-') && !state.world.departed?.some(actor => actor.id === who)) {
    history.replaceState(null, '', '#village');
    return false;
  }
  location.replace(residentLink({ id: who }) + '?latest=1');
  return true;
}
function navigate(){
  // #village/agnes opens the village following Agnes.
  const [key,who,record]=location.hash.slice(1).split('/');
  route=Object.hasOwn(names,key)?key:'village';
  if (leaveMissingResident()) return;
  if (route !== 'village') {
    exitMapFullscreen();
    residentHeat.hide();
  }
  else if (record === 'heat' && who) tab = 'heat';
  else if (tab === 'heat') tab = 'life';
  // An address that names a resident is a wish to follow them, so a watch gives way to it.
  if(who) { selected=who; if(watching) { watching=false; scene=null; director.reset(); map.watch(null); walk?.hold(null); } }
  if (villagePeople.some(person => person.id === selected && person.child)) { tab = 'life'; map.watch({ id: selected }); }
  for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==route;
  for(const link of document.querySelectorAll('nav a')){
    if(link.hash==='#'+route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  walk?.setActive(route==='village' && viewMode==='walk');
  (route==='village' ? $('plate-clock') : $('title-clock')).append($('clock'));
  $('page-title').hidden=route==='village' && Boolean(state);
  render();
}
let stream, retry;
function connection(online) {
  const badge = $('connection'), label = $('connection-label'), text = online ? 'World online' : 'Reconnecting';
  badge.classList.toggle('online', online);
  if (label.textContent !== text) {
    label.textContent = text;
    $('connection-mobile-label').textContent = text;
  }
  if (!online && !state) $('summary').textContent = 'Waiting for the village server. Reconnecting automatically…';
}
function disconnect() {
  clearTimeout(retry);
  stream?.close();
  stream = null;
}
function connect() {
  if (stream) return;
  const source = stream = new EventSource('/api/village/stream');
  let ready = false;
  function restart() {
    disconnect();
    connection(false);
    retry = setTimeout(connect, 1800);
  }
  function receive(event) {
    if (stream !== source) return;
    const now = performance.now(), baseline = event.type === 'snapshot';
    let next;
    try {
      const { state: payload, nextTickInMs } = JSON.parse(event.data);
      if (!baseline && !ready) throw new Error('Missing village snapshot');
      next = baseline ? payload : applyVillageChanges(latest, payload);
      if (!next.map || next.map.revision !== next.world.mapRevision || !Number.isFinite(nextTickInMs)) throw new Error('Invalid village update');
      if (sameGround(next.map, latest?.map)) next.map = latest.map;
      next.tickDueAt = now + nextTickInMs;
    } catch { restart(); return; }
    latest = next;
    ready = true;
    connection(true);
    if (!frozen) displayLatest();
  }
  source.addEventListener('snapshot', receive);
  source.addEventListener('update', receive);
  source.onerror = () => {
    if (stream !== source) return;
    ready = false;
    connection(false);
    if (source.readyState === EventSource.CLOSED) restart();
  };
}
$('freeze').addEventListener('click',()=>{
  if(!state)return;
  frozen=!frozen;
  $('freeze').setAttribute('aria-pressed',String(frozen));$('freeze').textContent=frozen?'Resume':'Pause';
  const pauseNotice = $('connection-pause');
  pauseNotice.hidden = !frozen;
  $('connection').title = frozen ? pauseNotice.textContent : '';
  if(frozen) render(); else displayLatest();
});
for(const btn of document.querySelectorAll('[data-tab]'))btn.addEventListener('click',()=>{
  tab=btn.dataset.tab;
  if (tab === 'heat' && selected) choose(selected);
  else {
    if (selected && location.hash.endsWith('/heat')) history.replaceState(null, '', '#village/' + selected);
    render();
  }
});
for(const btn of document.querySelectorAll('[data-view]'))btn.addEventListener('click',()=>show(btn.dataset.view));
$('zoom-in').addEventListener('click',()=>map.zoom(1.4));
$('zoom-out').addEventListener('click',()=>map.zoom(1/1.4));
$('zoom-home').addEventListener('click',()=>map.home());
const exitMapFullscreen = bindMapFullscreen($('map-fullscreen'));
$('pick-resident').addEventListener('change',e=>choose(e.target.value));
$('caption-back').addEventListener('click',()=>{release();render();});
$('watch').addEventListener('click',()=>watch(!watching,true));
bindVillageSound($('sound'), now => {
  if (route !== 'village' || frozen) return null;
  return (viewMode === 'walk' && walk?.soundScene(now)) || map.soundScene(now);
});
setInterval(direct,1000);
$('event-type').addEventListener('change',render);
window.addEventListener('hashchange',navigate);
window.addEventListener('pagehide', disconnect);
window.addEventListener('pageshow', connect);
navigate();connect();
