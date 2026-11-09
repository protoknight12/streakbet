// top tabs: StreakBet, Belot, Свара
$('#views').onclick = e => {
  const v = e.target.dataset.view;
  if (!v) return;
  $$('#views button').forEach(b => b.setAttribute('aria-pressed', b === e.target));
  $$('.view').forEach(s => s.hidden = s.id !== v);
  onView[v]?.();
  sfx('tick');
};
