import test from 'node:test';
import assert from 'node:assert/strict';
import { actionBody, choosePriority } from './decisions.mjs';
import { availableActions, createVillage, locationsOf } from './sim.mjs';

const observation = { goals: ['Keep the mill supplied'], needs: { hunger: 73, loneliness: 25, fatigue: 30 } };
test('a Decisions choice becomes a priority with factual context', async () => {
  const result = await choosePriority(observation, 'test-key', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/decisions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.input[0].content[0].type, 'input_json');
    assert.deepEqual(body.questions[0].choices.map(c => c.value).sort(), ['food','rest','social','work']);
    return Response.json({answers:[{name:'priority',type:'choice',choice:'food'}]});
  });
  assert.equal(result.focus, 'food');
  assert.match(result.reason, /73/);
});

test('a refusal or invalid priority cannot become a village plan', async () => {
  for (const answer of [{type:'refusal'}, {type:'choice',choice:'teleport'}]) {
    await assert.rejects(choosePriority(observation,'test-key',async () =>
      Response.json({answers:[{name:'priority',...answer}]})), /no valid priority/);
  }
});

test('live decisions show each resident’s own outing preference when the outing is feasible', () => {
  const village = createVillage();
  const { actors, world, map } = village;
  world.minute = 720;
  const names = locationsOf(map, actors);
  const requestFor = id => {
    const actor = actors.find(resident => resident.id === id);
    return JSON.parse(actionBody(actor, world, availableActions(actor, village), names));
  };
  const preference = body => body.input[0].content[0].data.preferredActivity;
  for (const [id, choice, interest] of [
    ['oswin', 'work:hunt:wood', /looking for game/],
    ['hugh', 'work:fish:fishing-bank', /enjoy fishing/],
    ['alice', 'work:fish:fishing-bank', /enjoy fishing/],
  ]) {
    const body = requestFor(id);
    assert.equal(preference(body).choice, choice);
    assert.match(preference(body).reason, interest);
    assert.match(body.questions[0].instructions, /when the resident’s needs and responsibilities allow/);
    const options = body.questions[0].choices;
    assert.ok(options.some(option => option.value === choice));
    assert.ok(options.some(option => option.value.startsWith('rest:')));
  }
  assert.equal(preference(requestFor('agnes')), undefined);
  actors.find(actor => actor.id === 'oswin').outings = { hunt: 0 };
  assert.equal(preference(requestFor('oswin')), undefined);
  world.minute = 0;
  assert.equal(preference(requestFor('hugh')), undefined);
});
