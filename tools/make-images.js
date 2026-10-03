// Generates the illustrated fallback pictures (SVG) for every fault type and category.
// Real photos placed next to them (same name, .jpg) automatically take priority in the app.
// Run:  node tools/make-images.js   (needs: npm i --no-save lucide-static)
const fs = require('fs'), path = require('path');
const { CATEGORIES } = require('../catalog');
const ICON_DIR = path.join(require.resolve('lucide-static/package.json'), '..', 'icons');

const TYPE_ICON = {
  cable_stolen: 'unplug', pole_down: 'zap-off', transformer: 'flame', exposed_wires: 'triangle-alert', outage: 'lightbulb-off', streetlight: 'lamp-floor',
  burst_pipe: 'shower-head', leakage: 'droplet', no_water: 'droplet-off', sewer: 'waves', open_manhole: 'circle-dashed',
  pothole: 'circle-dot', road_damage: 'construction', traffic_light: 'traffic-cone', flooding: 'cloud-rain', fallen_tree: 'tree-pine',
  collision: 'siren', breakdown: 'car', pedestrian: 'footprints', roadblock: 'octagon-x', other: 'map-pin'
};
const CAT_ICON = { electricity: 'zap', water: 'droplets', roads: 'construction', accident: 'siren', other: 'map-pin' };

const inner = name => fs.readFileSync(path.join(ICON_DIR, name + '.svg'), 'utf8').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

function art(id, iconName, color) {
  const g = inner(iconName);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs>
<radialGradient id="bg${id}" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${color}" stop-opacity=".38"/><stop offset="1" stop-color="#0B111A"/></radialGradient>
<pattern id="st${id}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="6" height="16" fill="#fff" opacity=".035"/></pattern>
<filter id="gl${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="256" height="256" fill="url(#bg${id})"/><rect width="256" height="256" fill="url(#st${id})"/>
<g transform="translate(120 130) scale(9)" fill="none" stroke="${color}" stroke-opacity=".16" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${g}</g>
<g transform="translate(68 68) scale(5)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" filter="url(#gl${id})">${g}</g>
</svg>`;
}

let n = 0;
for (const [ck, c] of Object.entries(CATEGORIES)) {
  fs.writeFileSync(path.join(__dirname, '../public/img/cats', ck + '.svg'), art('c' + ck, CAT_ICON[ck], c.color)); n++;
  for (const tk of Object.keys(c.types)) {
    if (!TYPE_ICON[tk]) throw new Error('No icon mapped for ' + tk);
    fs.writeFileSync(path.join(__dirname, '../public/img/faults', tk + '.svg'), art('t' + tk, TYPE_ICON[tk], c.color)); n++;
  }
}
console.log('Generated', n, 'pictures');

// Also export the small UI icons used by the app (inline SVG paths) as JSON for the build step
const UI = { home: ['house','home'], map: ['map'], plus: ['plus'], list: ['clipboard-list'], user: ['user'], users: ['users'], clock: ['clock'], check: ['check'], pin: ['map-pin'], locate: ['locate-fixed'], navigate: ['navigation'], layers: ['layers'], megaphone: ['megaphone'] };
const out = {};
for (const [k, names] of Object.entries(UI)) { const f = names.find(x => fs.existsSync(path.join(ICON_DIR, x + '.svg'))); out[k] = inner(f).replace(/\s+/g, ' ').trim(); }
fs.writeFileSync('/tmp/ui-icons.json', JSON.stringify(out));
