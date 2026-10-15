// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `set_mode`: put one device, or every device that offers it, in a mode —
// "night mode everywhere at bedtime" in one action instead of one per room.
// Outputs the number of devices changed. Throwing fails this action only.
//
// The trigger (`filter_to_replace`) is fired by the hub (src/hub.js).
// -----------------------------------------------------------------------------

import { MODES } from './blueair/model.js';

export const SCENE_ACTIONS = {
  async set_mode(hub, { fields }) {
    const mode = Object.values(MODES).includes(fields.mode) ? fields.mode : MODES.AUTO;
    const count = await hub.applyMode(fields.device || null, mode);
    return { count };
  },
};
