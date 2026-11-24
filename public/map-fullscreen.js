export function bindMapFullscreen(button) {
  const area = button.closest('.map-area');
  const expanded = () => area.classList.contains('map-expanded');
  const fullscreen = () => document.fullscreenElement === area;

  function sync() {
    const label = fullscreen() || expanded() ? 'Exit full screen' : 'Enter full screen';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  async function exit() {
    if (fullscreen()) await document.exitFullscreen();
    if (expanded()) {
      area.classList.remove('map-expanded');
      sync();
    }
  }

  button.addEventListener('click', async () => {
    if (fullscreen() || expanded()) return exit();
    if (document.fullscreenEnabled && area.requestFullscreen) {
      try {
        await area.requestFullscreen();
        return;
      } catch {
        // Some browsers and embeds disallow native fullscreen.
      }
    }
    if (area.closest('[hidden]')) return;
    area.classList.add('map-expanded');
    sync();
  });
  area.addEventListener('fullscreenchange', sync);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded()) {
      exit();
      button.focus({ preventScroll: true });
    }
  });
  area.addEventListener('focusout', event => {
    if (expanded() && event.relatedTarget && !area.contains(event.relatedTarget)) exit();
  });
  return exit;
}
