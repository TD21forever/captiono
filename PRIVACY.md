# Captiono Privacy Policy

Last updated: August 4, 2026

Captiono is a Chrome extension for studying captions on YouTube and Bilibili.
It displays the current video's available captions, highlights useful phrases,
lets users add annotations, and exports learning notes.

## Data handled by Captiono

Captiono processes the following data only to provide its user-facing features:

- The current supported video's title, URL, platform identifier, and available captions.
- Learning content created by the user, including annotations and saved phrases.
- Extension preferences, including appearance and phrase-display settings.

## How data is used

This data is used to display and synchronize captions with video playback,
highlight phrases, save learning progress, and generate user-requested exports.
Captiono does not use this data for advertising, profiling, analytics, or any
purpose unrelated to these features.

## Storage and transmission

Captiono stores normalized captions, annotations, saved phrases, and settings
locally in Chrome extension storage on the user's device. Captiono does not
operate a caption backend and does not transmit this stored learning data to
the Captiono developer or to third parties.

When reading captions, the extension communicates directly with the current
YouTube or Bilibili page and the platform's HTTPS caption endpoints. Temporary
signed caption URLs are not retained in extension storage or included in exports.

## Sharing and sale of data

Captiono does not sell user data. Captiono does not share user data with
advertisers, data brokers, or other third parties.

## Retention and deletion

Local learning data remains in Chrome extension storage until it is removed by
the user or the extension is uninstalled. Exported Markdown or JSON files are
controlled by the user after download.

## Permissions

- `storage` stores captions, annotations, saved phrases, and preferences locally.
- `scripting` restores Captiono's page module in an already-open supported tab
  when the extension is installed, updated, or explicitly opened by the user.
- Access to YouTube and Bilibili domains is limited to reading and displaying
  captions for the current supported video.

## Limited Use

Captiono's use of information received from Google APIs adheres to the Chrome
Web Store User Data Policy, including the Limited Use requirements.

## Changes and contact

Material changes to this policy will be reflected in this document and in the
extension or store listing when required. Questions can be submitted through
the Captiono GitHub repository:

https://github.com/TD21forever/captiono/issues
