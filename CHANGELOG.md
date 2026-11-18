# Changelog

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
