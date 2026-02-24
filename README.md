# Obsidian Underscore Underline Plugin

An Obsidian plugin that changes the behavior of the `_` (underscore) styling to render text as underlined instead of italic. 

Does the strict `**bold**` and `*italic*` implementation in standard markdown environments bother you? You're not alone. This plugin makes the `_` markdown toggle explicitly underline text across all views without disrupting native editing experiences!

## Features
- **Live Preview Support**: Native `_text_` markup will underline your text in the Live Preview editor organically, hiding marks correctly when the user is not actively editing the line.
- **Reading View Support**: Seamless reading view transformations for `_text_` to show the underline formatting across all your finalized pages.
- **Smart Toggle Command**: Expand selections or intelligently insert formatting marks dynamically via command palette or hotkeys.

## Installation
Currently you can install this manually into your Obsidian Vault:
1. Download the latest release from the Releases page.
2. Extract the `main.js`, `manifest.json` and `styles.css` files into a newly created `<vault>/.obsidian/plugins/obsidian-underscore-underline` directory.
3. Reload your plugins in Obsidian Settings.
4. Enable the plugin.

## Compatibility
Requires Obsidian v1.6.0 or higher.
