const kinds = new Set(['residents', 'households', 'promises', 'moots', 'days']);
const name = /^[a-z0-9_-]{1,200}$/i;
const minute = /^(?:0|[1-9]\d{0,11})$/;

export const residentLink = ({ id, arrived, left }) => '/residents/' + encodeURIComponent(id) +
  (arrived ? '/' + arrived : arrived == null && left != null ? '/left-' + left : '');
export const residentAtLink = (id, at) => '/residents/' + encodeURIComponent(id) + '?at=' + at;
export const householdLink = id => '/households/' + encodeURIComponent(id);
export const promiseLink = id => '/promises/' + encodeURIComponent(id);
export const mootLink = id => '/moots/' + id;
export const dayLink = at => '/days/' + (Math.floor(at / 1440) + 1);
export const housing = kind => ['cottage', 'hall', 'storehouse'].includes(kind);

export function recordPath(pathname) {
  const match = /^\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const [, kind, id, lifetime] = match;
  if (!kinds.has(kind) || (lifetime && kind !== 'residents')) return null;
  if (kind === 'moots' ? !id.startsWith('moot-') || !minute.test(id.slice(5))
    : kind === 'days' ? !/^[1-9]\d{0,8}$/.test(id) : !name.test(id)) return null;
  if (lifetime && !minute.test(lifetime.replace(/^left-/, ''))) return null;
  return { kind, id, lifetime };
}

export const validRecordMinute = value => minute.test(value);

export function copyLink(button, status, address) {
  button.hidden = false;
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(new URL(address, location.origin).href);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = 'You can copy this page’s address from your browser.';
    }
  };
}
