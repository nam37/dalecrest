const mobile = document.querySelector('.mobile-site-menu');
const menus = [...document.querySelectorAll('.site-more, .mobile-site-menu, .mobile-connection')];

document.addEventListener('click', event => {
  for (const menu of menus) {
    const followedLink = menu === mobile && event.target instanceof Element && event.target.closest('a');
    if (menu.open && (!menu.contains(event.target) || followedLink)) menu.open = false;
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const menu = menus.find(disclosure => disclosure.open && disclosure.getClientRects().length);
  if (!menu) return;
  const focused = menu.contains(document.activeElement);
  menu.open = false;
  if (focused) menu.querySelector('summary').focus();
  event.preventDefault();
});

matchMedia('(max-width: 960px)').addEventListener('change', () => {
  for (const menu of menus) menu.open = false;
});
