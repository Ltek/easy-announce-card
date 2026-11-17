# Changelog

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
