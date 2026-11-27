// Residents who need a choice at the same moment are served side by side. A lane takes one waiting
// resident at a time and goes straight on to the next. A lane that sends a request opens another while
// the reply is on its way, so a queue at dawn is worked by several lanes and a quiet village by one.
export const PLANNER_LANES = Math.max(1, Math.min(6, Math.trunc(Number(process.env.PLANNER_LANES)) || 3));

// step() does one piece of work and says whether there may be more: 'sent' after a request went out,
// 'done' after finishing a recorded reply, or false when nothing is waiting or the budget says stop.
export function createLanes(step, { lanes = PLANNER_LANES, failed = () => {} } = {}) {
  let running = 0;
  function open() {
    if (running >= lanes) return null;
    running++;
    return (async () => {
      try {
        for (;;) {
          const outcome = await step(open);
          if (!outcome) return;
        }
      } catch (error) {
        failed(error);
      } finally {
        running--;
      }
    })();
  }
  return { open, get running() { return running; } };
}
