# Changelog

## v2026.11.19.5

- **Columns per orientation:** `columns_landscape` (default 3) and `columns_portrait` (default 2). With
  `orientation: auto` (the default) the card follows the screen, using the portrait count when the screen is
  taller than it is wide, and switches as a tablet turns. `orientation: landscape` or `portrait` always uses
  that count. A card that set `columns` keeps that count in both orientations.
- **Compact tiles** (`tile_layout: compact`): the volume controls sit to the right of the speaker's name
  and state, not under them. Auto columns give compact tiles more room.
- **Hide "This Device"** (`hide_this_device`, on by default): Alexa Media Player's entity for the Alexa app.
  Add it under Always add to show it anyway.
- **All / None are chips**, and the one that matches the selection is lit.
- **Larger default text and icons**, e.g. speaker names 16 px (was 13), speaker icons 32 px (was 24), title
  18 px (was 14). Sizes you set yourself stay as they are.
- "Announce at" is now **"Announce Volume"**.

## v2026.11.18.4

- **Style each item on its own.** Every piece of text on the card has its own size, weight and color: title,
  preset chips, message box, Send text, "Announce at", the volume readout, "Speakers" heading, selected count,
  All / None, speaker names, speaker state and the status line. Every icon has its own size and color: edit,
  delete and save preset, Send, speaker (plus its selected color), check mark, mute (plus muted) and power
  (plus on). In Appearance, grouped by where they are on the card.
- Cards set up before keep their look: the old `font_size_title`, `font_size_message` (presets and message
  box), `font_size_name`, `icon_size`, `color_title`, `color_preset` and `color_icon` move to the new keys.

## v2026.11.18.3

- **Everywhere speaker placement** (`everywhere_position`): Alexa's "Everywhere" group now gets its own full-width row above the other speakers by default. It can also go in its own row below them, or first or last in the list. The card finds it by name; pick it in Speakers → Everywhere (`everywhere_entity`) if yours is named differently.
- Editor footer: ⭐ Star on GitHub and 🐛 Report an issue links.

## v2026.11.17.2

- **Volume on each speaker:** a volume slider, a mute button and a power button, each shown or hidden on its
  own (`show_volume`, `show_mute`, `show_power`; power is off by default). They only show on speakers that
  support them, and using them never selects the speaker.
- **Announce at a set volume:** an "Announce at" switch and slider by the message (`show_announce_volume`,
  starting level `announce_volume`). Every selected speaker is set to it just before the announcement.
- **Put the volume back** afterwards (`restore_volume`, on by default), after `restore_after` seconds or an
  estimate from the message length. Back-to-back announcements restore the volume from before the first.
- The card is called **Easy Announce Card (Ltek)** everywhere: the editor footer and the README title now match its HACS name.

## v2026.11.17.1

First release.

- **Presets** from an `input_select`, as chips or a dropdown. Admins can save the typed message as a preset
  and delete presets from the card; placeholder options like `---` stay first.
- **Speakers found on their own** from Alexa Media Player (or every media player), with exclude patterns
  on the entity ID, name or integration, always-add entities, and words to drop from names.
- **One call for every selected speaker**, through `notify.alexa_media` (announce or speak) or a script
  that gets `message` and a `target` list. Or tap a speaker to announce on it straight away.
- Speaker tiles show what each speaker is doing; offline speakers are hidden or greyed out.
- The selected speakers and the typed message survive the dashboard editor redrawing the card; the
  selection is remembered per browser.
- Visual editor with the shared Ltek layout, four-mode color controls and size sliders.
