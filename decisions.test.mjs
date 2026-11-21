import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePriority } from './decisions.mjs';

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
