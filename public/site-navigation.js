const more = document.querySelector('.site-more');
const toggle = more.querySelector('summary');

document.addEventListener('click', event => {
  if (more.open && !more.contains(event.target)) more.open = false;
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !more.open || event.defaultPrevented) return;
  more.open = false;
  if (more.contains(document.activeElement)) toggle.focus();
  event.preventDefault();
});
