// Effect registry + switcher.
//
// Effect interface:
//   { name, mount(stage), unmount(stage), update(frame) }
// To add an effect, write a factory returning that shape and add it to EFFECTS.
import { PINCH_COOLDOWN_MS } from "../gestures.js";
import { createAura } from "./aura.js";
import { createParticles } from "./particles.js";
import { createFilters } from "./filters.js";

export const EFFECTS = [createAura, createParticles, createFilters];

export function createSwitcher(stage, onChange = () => {}) {
  const effects = EFFECTS.map((make) => make());
  let index = 0;
  let lastFire = -Infinity;
  effects[index].mount(stage);
  onChange(effects[index], index);

  function select(i) {
    i = ((i % effects.length) + effects.length) % effects.length;
    if (i === index) return;
    effects[index].unmount(stage);
    index = i;
    effects[index].mount(stage);
    onChange(effects[index], index);
  }

  return {
    get current() {
      return effects[index];
    },
    get count() {
      return effects.length;
    },
    select,
    next() {
      select(index + 1);
    },
    // Pinch fire from any hand; global cooldown so two hands can't double-switch.
    fire(nowMs) {
      if (nowMs - lastFire < PINCH_COOLDOWN_MS) return false;
      lastFire = nowMs;
      select(index + 1);
      return true;
    },
  };
}
