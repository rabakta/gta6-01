// BRISA BAY — buyable businesses. Three corner shops double as
// properties Jay can buy: the shop keeps selling as before, and the
// business pays rent every game hour into Jay's pocket. Ownership lives
// in the save (properties: [shop index, ...]); the income tick rides the
// day/night clock, so it costs nothing per frame.
import { SHOPS } from './config.js';

// shop: index into SHOPS. price: one-off buy cost. income: $ per game hour.
// Three kinds, three corners: a garage south-east, a taco stand
// south-west, a gun shop east. Prices need a few missions first; the
// rent is modest next to mission rewards ($500-$5000).
export const PROPERTIES = [
  { shop: 3, price: 3000, income: 60 }, // GARAGE 24
  { shop: 5, price: 2000, income: 40 }, // TACO SOL
  { shop: 1, price: 5000, income: 90 }, // AMMU-NATION
];

// The for-sale entry for a SHOPS index, or undefined.
export function propEntry(shopIdx) {
  return PROPERTIES.find((p) => p.shop === shopIdx);
}

// A world shop's SHOPS index (city.js spreads the entry, so match by pos).
export function shopIndex(shop) {
  return SHOPS.findIndex((s) => s.pos[0] === shop.x && s.pos[1] === shop.z);
}

export class PropertiesManager {
  // `game` is the main game object (save, tod, state, notify, audio).
  constructor(game) {
    this.game = game;
    this.lastHour = -1;
  }
  owned() { return this.game.save.properties || []; }
  isOwned(i) { return this.owned().indexOf(i) >= 0; }
  rate() {
    let t = 0;
    for (const i of this.owned()) { const e = propEntry(i); if (e) t += e.income; }
    return t;
  }
  // One row for the shop UI: BUY, OWNED, or '' when not for sale.
  shopRow(shop) {
    const i = shopIndex(shop);
    const e = propEntry(i);
    if (!e) return '';
    if (this.isOwned(i)) return '<button disabled><b>OWNED - earns $' + e.income + '/hour</b><span>Your business</span></button>';
    return '<button data-buy="biz"><b>BUY THIS BUSINESS - $' + e.price + '</b><span>Earns $' + e.income + ' every game hour</span></button>';
  }
  // Buy the business of the shop Jay is standing in. False when there is
  // nothing to buy, it is already owned, or the cash is short.
  buy(shop) {
    const g = this.game;
    if (!shop) return false;
    const i = shopIndex(shop);
    const e = propEntry(i);
    if (!e || this.isOwned(i)) return false;
    if (g.save.cash < e.price) { g.notify('Not enough cash - ' + SHOPS[i].name + ' costs $' + e.price + '.'); return false; }
    g.save.cash -= e.price;
    if (!g.save.properties) g.save.properties = [];
    g.save.properties.push(i);
    g.notify('You own ' + SHOPS[i].name + '! +$' + e.income + ' every hour.');
    if (g.audio && g.audio.jingle) g.audio.jingle();
    return true;
  }
  // 'BIZ 2 · +$100/h' for the HUD, '' when Jay owns nothing.
  hudLine() {
    const n = this.owned().length;
    return n ? 'BIZ ' + n + ' · +$' + this.rate() + '/h' : '';
  }
  // Rent lands once per game hour crossed (a game hour is a real minute).
  // The first call only seeds the hour, so loading a save never pays out.
  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    const hour = Math.floor(g.tod * 24);
    if (this.lastHour < 0) { this.lastHour = hour; return; }
    if (hour === this.lastHour) return;
    const crossed = (hour - this.lastHour + 24) % 24;
    this.lastHour = hour;
    const pay = this.rate() * crossed;
    if (pay <= 0) return;
    g.save.cash += pay;
    g.save.stats.bizEarned = (g.save.stats.bizEarned || 0) + pay;
    g.notify('Business income +$' + pay + '.');
  }
}
