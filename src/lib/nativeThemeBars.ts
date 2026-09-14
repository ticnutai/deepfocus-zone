import { registerPlugin } from '@capacitor/core';

const bars = registerPlugin<{ apply(options: { color: string; darkIcons: boolean }): Promise<void> }>('ThemeBars');

export function nativeBarAppearance(rgb: string) {
  const values = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  const [r, g, b] = values?.length === 3 ? values : [250, 249, 247];
  return {
    color: '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''),
    darkIcons: (r * 299 + g * 587 + b * 114) / 1000 > 150,
  };
}

export function startNativeThemeBars() {
  let last = '';
  const update = () => {
    const value = nativeBarAppearance(getComputedStyle(document.body).backgroundColor);
    const key = JSON.stringify(value);
    if (key === last) return;
    last = key;
    void bars.apply(value).catch(error => { last = ''; console.warn('Native theme bars unavailable', error); });
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  const resume = () => { last = ''; update(); };
  document.addEventListener('visibilitychange', resume);
  update();
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', resume); };
}
