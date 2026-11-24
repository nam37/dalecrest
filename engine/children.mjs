import { dateOf } from './calendar.mjs';
import { ageOf, COMES_OF_AGE, tooIll } from './lives.mjs';
import { WOODPILE_HOLDS } from './households.mjs';
import { place, route, walkingSegment, walkingSpeed } from './roads.mjs';
import { restDay } from './workday.mjs';

const DAY = 1440;
const LESSON_MINUTES = 75;
const LESSON_DAYS = new Set(['Monday', 'Wednesday', 'Saturday']);
const schoolAge = (child, minute) => ageOf(child, minute) >= 6 && ageOf(child, minute) < COMES_OF_AGE;
const sunTime = minute => minute % DAY;
const dayOf = minute => Math.floor(minute / DAY);
const fullName = child => [child.name, child.surname].filter(Boolean).join(' ');

export function childView(child, home, minute) {
  return { id: child.id, name: fullName(child), child: true, age: ageOf(child, minute), born: child.born,
    role: 'Child', home, action: child.action, position: child.position };
}

export function childResidents(world) {
  return Object.entries(world.cottages || {}).flatMap(([home, cottage]) =>
    (cottage.children || []).filter(child => child.id && child.action).map(child => childView(child, home, world.minute)));
}

// The saved cottage record owns the child. Its id follows them through moves and into adulthood.
export function prepareChildren({ world, actors, map }) {
  for (const [home, cottage] of Object.entries(world.cottages || {})) {
    for (const child of cottage.children || []) {
      if (child.id && child.action) continue;
      const site = place(map, home);
      if (!site) continue;
      if (!child.id) {
        world.nextChildId = (world.nextChildId || 0) + 1;
        child.id = 'child-' + world.nextChildId;
      }
      const guardian = actors.find(actor => child.parents?.includes(actor.id));
      child.surname ??= guardian?.name.split(' ').at(-1) || '';
      child.position ??= { x: site.at[0], y: site.at[1] };
      child.action ??= { kind: 'rest', label: 'Staying at home', target: home, phase: 'working', remaining: 0 };
    }
  }
}

function hallFree({ world, actors, map }) {
  const moot = world.moot;
  return place(map, 'hall')?.stage === 2 && (!moot || world.minute < moot.at - 40 || world.minute > moot.at + 100)
    && !actors.some(actor => actor.action.target === 'hall' && ['meeting', 'ballot'].includes(actor.action.kind));
}

export function lessonOffer(actor, state) {
  const { world } = state, minute = world.minute;
  if (!actor.schoolTeacher || tooIll(actor) || sunTime(minute) < 480 || sunTime(minute) > 630
      || !LESSON_DAYS.has(dateOf(minute).weekday) || restDay(minute) || world.school?.lastDay === dayOf(minute)
      || !hallFree(state)
      || !Object.values(world.cottages || {}).some(cottage => cottage.children?.some(child => schoolAge(child, minute)))) return;
  return { duration: LESSON_MINUTES, reason: 'I can teach the children their letters and reading at the hall this morning.' };
}

export function teachMinute(actor, state) {
  const { world } = state, minute = world.minute;
  if (tooIll(actor) || !hallFree(state)) return false;
  const school = world.school ??= {};
  if (!school.lesson) {
    if (school.lastDay === dayOf(minute) || sunTime(minute) > 660) return false;
    school.lastDay = dayOf(minute);
    school.lesson = { teacher: actor.id, name: actor.name, started: minute, taught: 0, pupils: {} };
  }
  if (school.lesson.teacher !== actor.id) return false;
  school.lesson.taught++;
  school.lesson.lastMinute = minute;
  return true;
}

function finishLesson(school, lesson, emit) {
  const pupils = Object.values(lesson.pupils);
  const completed = lesson.taught === LESSON_MINUTES;
  const first = pupils.length > 0 && !school.firstLesson;
  if (first) school.firstLesson = lesson.started;
  const names = pupils.map(pupil => pupil.name).join(', ');
  const text = pupils.length
    ? lesson.name + ' taught ' + (first ? 'the village’s first lesson' : 'a lesson') + ' in letters and reading at the hall. Pupils present included ' + names + '.'
    : lesson.name + ' held time for a lesson at the hall, but no pupils reached it.';
  emit('village', text, [lesson.teacher, ...Object.keys(lesson.pupils)],
    { lesson: 'letters', status: completed ? 'completed' : 'interrupted', first, started: lesson.started,
      minutes: lesson.taught, pupils }, 'hall');
  delete school.lesson;
}

const actionFor = {
  rest: { label: 'Staying at home' },
  play: { label: 'Playing on the green' },
  lesson: { label: 'Learning letters at the hall', indoors: true },
  kindling: { label: 'Gathering kindling', remaining: 12 },
  carrying: { label: 'Taking kindling home' },
};

function chooseChild(child, home, cottage, world, age, lesson, weather) {
  const { minute } = world, time = sunTime(minute);
  if (child.action.kind === 'arrive' && child.action.phase === 'travelling') return ['arrive', home];
  if (child.action.kind === 'carrying') return ['carrying', home];
  if (age < 5 || time >= 1080) return ['rest', home];
  if (lesson && age >= 6 && age < COMES_OF_AGE && !cottage.hungry) return ['lesson', 'hall'];
  if (time < 500 || (cottage.hungry && time < 680) || weather.rain > 0.7 || weather.snow > 0.5) return ['rest', home];
  const day = dayOf(minute), order = Number(child.id.split('-').at(-1));
  if (age >= 8 && time >= 720 + order % 8 * 10 && time < 972 && !restDay(minute) && cottage.lastKindling !== day
      && cottage.woodpile < 5 && world.supplies.wood > 2) return ['kindling', 'wood'];
  if (time >= 565 + order % 8 * 10) return ['play', 'green'];
  return ['rest', home];
}

function setChildAction(child, kind, target, map) {
  if (child.action.kind === kind && child.action.target === target) return;
  const path = route(map, [child.position.x, child.position.y], target)?.pts;
  if (!path) return;
  child.action = { remaining: 1, ...actionFor[kind], kind, target, phase: 'travelling', path };
}

function stepChild(child, home, cottage, state, lesson, weather, emit) {
  const { world, map } = state, age = ageOf(child, world.minute);
  const [kind, target] = chooseChild(child, home, cottage, world, age, lesson, weather);
  setChildAction(child, kind, target, map);
  const action = child.action;
  if (action.phase === 'travelling') {
    const guardian = action.kind === 'arrive' && state.actors.find(actor => actor.id === child.parents?.[0]);
    if (guardian?.action?.kind === 'arrive' && guardian.action.target === home) {
      child.position = { ...guardian.position };
      action.phase = guardian.action.phase;
      action.familyPace = walkingSpeed(guardian);
      return;
    }
    delete action.familyPace;
    if (!action.path) action.path = route(map, [child.position.x, child.position.y], action.target)?.pts;
    if (!action.path) return;
    const { points, passed } = walkingSegment({ child: true, age, position: child.position, action }, action.path);
    if (points.length) {
      const [x, y] = points.at(-1);
      child.position = { x, y };
    }
    action.path.splice(0, passed);
    if (action.path.length) return;
    delete action.path;
    action.phase = 'working';
  }
  if (action.kind === 'lesson' && lesson) {
    const pupil = lesson.pupils[child.id] ??= { id: child.id, name: fullName(child), minutes: 0 };
    pupil.minutes++;
  } else if (action.kind === 'kindling' && --action.remaining <= 0) {
    setChildAction(child, 'carrying', home, map);
  } else if (action.kind === 'carrying') {
    const day = dayOf(world.minute);
    if (cottage.lastKindling !== day && cottage.woodpile < WOODPILE_HOLDS && world.supplies.wood > 2) {
      cottage.lastKindling = day;
      cottage.woodpile++;
      world.supplies.wood--;
      emit('work', fullName(child) + ' brought a bundle of kindling home.', [child.id, ...(child.parents || [])],
        { chore: 'kindling', status: 'completed', home, stockDelta: { wood: -1 }, householdDelta: { woodpile: 1 } }, home);
    }
    setChildAction(child, 'rest', home, map);
  }
}

export function tickChildren(state, weather, emit) {
  const { world, actors } = state;
  prepareChildren(state);
  const school = world.school, lesson = school?.lesson;
  const active = lesson?.lastMinute === world.minute ? lesson : null;
  for (const [home, cottage] of Object.entries(world.cottages || {})) {
    for (const child of cottage.children || []) if (child.action) stepChild(child, home, cottage, state, active, weather, emit);
  }
  if (lesson && (!active || actors.find(actor => actor.id === lesson.teacher)?.action.remaining === 0)) finishLesson(school, lesson, emit);
}
